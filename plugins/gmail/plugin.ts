/**
 * Gmail built-in plugin — wraps server/lib/gmail.ts and the incremental sync
 * logic formerly in server/routes/gmail.ts.
 *
 * Auth: per-user OAuth (Google). The plugin uses PluginContext.getCredential("google")
 * to obtain the user's access token.
 */

import * as gmail from "./app/lib/gmail.js"
import type { ThreadSummary } from "./app/lib/gmail.js"
import { get as getCached, set as setCached, invalidate } from "../../server/lib/cache.js"
import type { Plugin, PluginContext } from "../../src/types/plugin.js"

const SYNC_TTL = 86_400_000 // 24h

/** Add derived boolean fields from labelIds for badge rendering. */
function addDerivedFields(thread: ThreadSummary): ThreadSummary & { isImportant: boolean; isStarred: boolean } {
  return {
    ...thread,
    isImportant: thread.labelIds.includes("IMPORTANT"),
    isStarred: thread.labelIds.includes("STARRED"),
  }
}

type SyncState = {
  historyId: string
  threads: ThreadSummary[]
  nextPageToken: string | null
}

async function requireToken(ctx?: PluginContext): Promise<string> {
  if (!ctx) throw new Error("Google account not connected. Go to Settings → Integrations to connect Google.")
  const token = await ctx.getCredential("google")
  if (!token) throw new Error("Google account not connected. Go to Settings → Integrations to connect Google.")
  return token
}

async function sendWithSignature(
  accessToken: string,
  params: { to: string; subject: string; body: string; threadId?: string; inReplyTo?: string },
) {
  const signature = await gmail.getSignature(accessToken)
  return gmail.sendMessage(accessToken, params.to, params.subject, params.body, params.threadId, params.inReplyTo, signature)
}

async function createDraftWithSignature(
  accessToken: string,
  params: { to: string; subject: string; body: string; threadId?: string; inReplyTo?: string },
) {
  const signature = await gmail.getSignature(accessToken)
  return gmail.createDraft(accessToken, params.to, params.subject, params.body, params.threadId, params.inReplyTo, signature)
}

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", txt: "text/plain", zip: "application/zip",
  mp4: "video/mp4", mp3: "audio/mpeg",
}

function mimeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase()
  return MIME_MAP[ext || ""] || "application/octet-stream"
}

function sniffMimeType(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png"
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg"
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif"
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp"
  if (buf[0] === 0x25 && buf[1] === 0x50) return "application/pdf"
  return "application/octet-stream"
}

export const gmailPlugin: Plugin = {
  id: "gmail",
  name: "Emails",
  icon: "Mail",
  emoji: "✉️",
  components: { tab: "gmail:tab" },
  auth: { integrationId: "google", scope: "user" },

  fieldSchema: [
    { id: "from", label: "From", type: "text", listRole: "title" },
    { id: "subject", label: "Subject", type: "text", listRole: "subtitle" },
    { id: "date", label: "Date", type: "date", listRole: "timestamp" },
    {
      id: "isUnread", label: "Unread", type: "boolean",
      badge: { show: "if-set", variant: "secondary" },
    },
    {
      id: "isImportant", label: "Important", type: "boolean",
      badge: { show: "if-set", variant: "secondary" },
    },
    {
      id: "isStarred", label: "Starred", type: "boolean",
      badge: { show: "if-set", variant: "secondary" },
    },
    { id: "body", label: "Body", type: "html", listRole: "hidden" },
    {
      id: "flags", label: "Flags", type: "text", listRole: "hidden",
      filter: { filterable: true, filterOptions: ["important", "starred", "unread", "snoozed"] },
    },
    { id: "labels", label: "Labels", type: "text", listRole: "hidden", filter: { filterable: true } },
  ],

  async query(filters, cursor, ctx) {
    const accessToken = await requireToken(ctx)
    const userEmail = ctx!.userEmail

    // Build Gmail search query from filters
    const parts: string[] = []
    if (filters.q) parts.push(filters.q)
    else parts.push("in:inbox")
    if (filters.flags) {
      for (const flag of filters.flags.split(",")) {
        parts.push(`is:${flag.trim()}`)
      }
    }
    if (filters.labels) {
      for (const label of filters.labels.split(",")) {
        parts.push(`label:${label.trim()}`)
      }
    }
    const query = parts.join(" ")
    const max = 20
    const pageToken = cursor

    // Incremental sync (first page only)
    if (!pageToken) {
      const syncKey = `gmail:sync:${userEmail}:${query}:${max}`
      const syncState = await getCached<SyncState>(syncKey)

      if (syncState?.historyId) {
        try {
          const history = await gmail.getHistory(accessToken, syncState.historyId)
          const changedThreadIds = new Set<string>()
          for (const h of history.history || []) {
            for (const { message } of h.messagesAdded || []) changedThreadIds.add(message.threadId)
            for (const { message } of h.messagesDeleted || []) changedThreadIds.add(message.threadId)
            for (const { message } of h.labelsAdded || []) changedThreadIds.add(message.threadId)
            for (const { message } of h.labelsRemoved || []) changedThreadIds.add(message.threadId)
          }

          const newHistoryId = history.historyId || syncState.historyId

          if (changedThreadIds.size === 0) {
            await setCached(syncKey, { ...syncState, historyId: newHistoryId }, SYNC_TTL)
            return { items: syncState.threads as any[], nextCursor: syncState.nextPageToken ?? undefined }
          }

          const updatedThreads = await gmail.fetchBatched(
            [...changedThreadIds],
            (id) => gmail.getThreadSummary(accessToken, id),
          )
          for (const id of changedThreadIds) await invalidate(`gmail:thread:${id}`)

          const updatedMap = new Map(updatedThreads.map((t) => [t.id, t]))
          let threads = syncState.threads
            .map((t) => updatedMap.get(t.id) || t)
            .filter((t) => {
              const updated = updatedMap.get(t.id)
              return updated ? updated.labelIds.includes("INBOX") : true
            })
          const existingIds = new Set(threads.map((t) => t.id))
          for (const t of updatedThreads) {
            if (!existingIds.has(t.id) && t.labelIds.includes("INBOX")) {
              threads.unshift(t)
            }
          }

          await setCached(syncKey, { historyId: newHistoryId, threads, nextPageToken: syncState.nextPageToken }, SYNC_TTL)
          return { items: threads.map(addDerivedFields) as any[], nextCursor: syncState.nextPageToken ?? undefined }
        } catch (e: any) {
          console.warn("Incremental sync failed, falling back to full sync:", e.message)
          await invalidate(`gmail:sync:${userEmail}:${query}:${max}`)
        }
      }
    }

    // Full sync
    const result = await gmail.searchThreads(accessToken, query, max, pageToken || undefined)
    if (!pageToken && result.historyId) {
      const syncKey = `gmail:sync:${userEmail}:${query}:${max}`
      await setCached(syncKey, { historyId: result.historyId, threads: result.threads, nextPageToken: result.nextPageToken }, SYNC_TTL)
    }
    return { items: result.threads.map(addDerivedFields) as any[], nextCursor: result.nextPageToken ?? undefined }
  },

  async getItem(threadId, ctx) {
    const accessToken = await requireToken(ctx)
    return await gmail.getThread(accessToken, threadId) as any
  },

  async mutate(id, action, payload, ctx) {
    const accessToken = await requireToken(ctx)
    let skipInvalidate = false
    switch (action) {
      case "archive":
        await gmail.modifyThreadLabels(accessToken, id, [], ["INBOX"])
        break
      case "trash":
        await gmail.trashThread(accessToken, id)
        break
      case "star":
        await gmail.modifyThreadLabels(accessToken, id, ["STARRED"], [])
        break
      case "unstar":
        await gmail.modifyThreadLabels(accessToken, id, [], ["STARRED"])
        break
      case "mark-important":
        await gmail.modifyThreadLabels(accessToken, id, ["IMPORTANT"], [])
        break
      case "mark-not-important":
        await gmail.modifyThreadLabels(accessToken, id, [], ["IMPORTANT"])
        break
      case "modify-labels": {
        const { addLabelIds, removeLabelIds } = (payload ?? {}) as { addLabelIds?: string[]; removeLabelIds?: string[] }
        await gmail.modifyThreadLabels(accessToken, id, addLabelIds || [], removeLabelIds || [])
        break
      }
      case "send": {
        const { to, subject, body, threadId, inReplyTo } = (payload ?? {}) as any
        await sendWithSignature(accessToken, { to, subject, body, threadId, inReplyTo })
        if (threadId) await invalidate(`gmail:thread:${threadId}`)
        break
      }
      case "save-draft": {
        const { to, subject, body, threadId, inReplyTo } = (payload ?? {}) as any
        await createDraftWithSignature(accessToken, { to, subject, body, threadId, inReplyTo })
        skipInvalidate = true
        break
      }
      default:
        throw new Error(`Unknown Gmail action: ${action}`)
    }
    if (!skipInvalidate) {
      await invalidate("gmail:sync:")
      await invalidate(`gmail:thread:${id}`)
    }
  },

  filterOptions: {
    labels: async (ctx) => {
      const accessToken = await requireToken(ctx)
      const result = await gmail.getLabels(accessToken)
      return result.labels
        .filter((l: any) => l.type === "user")
        .sort((a: any, b: any) => a.name.localeCompare(b.name))
        .map((l: any) => l.name)
    },
  },

  routes(app, { getContext }) {
    // Attachment proxy
    app.get("/messages/:id/attachments/:attachmentId", async (c) => {
      const ctx = await getContext(c)
      const accessToken = await requireToken(ctx)
      const messageId = c.req.param("id")
      const attachmentId = c.req.param("attachmentId")
      const data = await gmail.getAttachment(accessToken, messageId, attachmentId)
      const filename = c.req.query("filename")
      const mime = filename ? mimeFromFilename(filename) : sniffMimeType(data)
      return new Response(new Uint8Array(data), {
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Type": mime,
          ...(filename ? { "Content-Disposition": `inline; filename="${filename}"` } : {}),
        },
      })
    })

    app.get("/signature", async (c) => {
      const ctx = await getContext(c)
      const accessToken = await requireToken(ctx)
      const signature = await gmail.getSignature(accessToken)
      return c.json({ signature })
    })

    app.get("/labels", async (c) => {
      const ctx = await getContext(c)
      const accessToken = await requireToken(ctx)
      const result = await gmail.getLabels(accessToken)
      return c.json(result)
    })

    app.post("/send", async (c) => {
      const ctx = await getContext(c)
      const accessToken = await requireToken(ctx)
      const { to, subject, body, threadId, inReplyTo } = await c.req.json()
      const result = await sendWithSignature(accessToken, { to, subject, body, threadId, inReplyTo })
      await invalidate("gmail:sync:")
      if (threadId) await invalidate(`gmail:thread:${threadId}`)
      return c.json(result)
    })

    // Drafts
    app.post("/drafts", async (c) => {
      const ctx = await getContext(c)
      const accessToken = await requireToken(ctx)
      const { to, subject, body, threadId, inReplyTo } = await c.req.json()
      const result = await createDraftWithSignature(accessToken, { to, subject, body, threadId, inReplyTo })
      return c.json(result)
    })

    // Trash thread
    app.post("/threads/:id/trash", async (c) => {
      const ctx = await getContext(c)
      const accessToken = await requireToken(ctx)
      const id = c.req.param("id")
      await gmail.trashThread(accessToken, id)
      await invalidate("gmail:sync:")
      await invalidate(`gmail:thread:${id}`)
      return c.json({ ok: true })
    })

    // Modify thread labels
    app.patch("/threads/:id/labels", async (c) => {
      const ctx = await getContext(c)
      const accessToken = await requireToken(ctx)
      const id = c.req.param("id")
      const { addLabelIds, removeLabelIds } = await c.req.json()
      await gmail.modifyThreadLabels(accessToken, id, addLabelIds || [], removeLabelIds || [])
      await invalidate("gmail:sync:")
      await invalidate(`gmail:thread:${id}`)
      return c.json({ ok: true })
    })

    // Modify message labels
    app.patch("/messages/:id/labels", async (c) => {
      const ctx = await getContext(c)
      const accessToken = await requireToken(ctx)
      const { addLabelIds, removeLabelIds } = await c.req.json()
      await gmail.modifyLabels(accessToken, c.req.param("id"), addLabelIds || [], removeLabelIds || [])
      return c.json({ ok: true })
    })

    // Get single message
    app.get("/messages/:id", async (c) => {
      const ctx = await getContext(c)
      const accessToken = await requireToken(ctx)
      const id = c.req.param("id")
      const message = await gmail.getMessage(accessToken, id)
      return c.json(message)
    })

    // Get thread (alias for getItem — preserves /threads/:id URL)
    app.get("/threads/:id", async (c) => {
      const ctx = await getContext(c)
      const accessToken = await requireToken(ctx)
      const id = c.req.param("id")
      const thread = await gmail.getThread(accessToken, id)
      return c.json(thread)
    })

    // List messages (alias for query — preserves /messages URL)
    app.get("/messages", async (c) => {
      const raw = c.req.query()
      const ctx = await getContext(c)
      const result = await gmailPlugin.query!(
        { q: raw.q || "in:inbox" },
        raw.pageToken || undefined,
        ctx,
      )
      return c.json({ messages: result.items, nextPageToken: result.nextCursor ?? null })
    })
  },
}

export default gmailPlugin
