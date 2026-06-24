/**
 * Gmail built-in plugin — wraps server/lib/gmail.ts and the incremental sync
 * logic formerly in server/routes/gmail.ts.
 *
 * Auth: per-user OAuth (Google). The plugin uses PluginContext.getCredential("google")
 * to obtain the user's access token.
 */

import * as gmail from "./app/lib/gmail.js"
import type { ThreadSummary } from "./app/lib/gmail.js"
import type { Plugin, PluginContext } from "../../src/types/plugin.js"

const MAX_LABEL_BADGES = 3

/** Add derived boolean fields and user label names from labelIds for badge rendering. */
function addDerivedFields(
  thread: ThreadSummary,
  userLabelMap: Map<string, string>,
): ThreadSummary & { isImportant: boolean; isStarred: boolean; labels: string[] } {
  const labels: string[] = []
  for (const id of thread.labelIds) {
    const name = userLabelMap.get(id)
    if (name) labels.push(name)
    if (labels.length >= MAX_LABEL_BADGES) break
  }
  return {
    ...thread,
    isImportant: thread.labelIds.includes("IMPORTANT"),
    isStarred: thread.labelIds.includes("STARRED"),
    labels,
  }
}

const userLabelCache = new Map<string, { value: Map<string, string>; ts: number }>()
const USER_LABEL_TTL = 5 * 60 * 1000

async function getUserLabelMapCached(accessToken: string): Promise<Map<string, string>> {
  const cached = userLabelCache.get(accessToken)
  if (cached && Date.now() - cached.ts < USER_LABEL_TTL) return cached.value
  const result = await gmail.getLabels(accessToken)
  const map = new Map<string, string>()
  for (const l of result.labels) {
    if (l.type === "user") map.set(l.id, l.name)
  }
  userLabelCache.set(accessToken, { value: map, ts: Date.now() })
  return map
}

async function requireToken(ctx?: PluginContext): Promise<string> {
  if (!ctx) throw new Error("Google account not connected. Go to Settings → Integrations to connect Google.")
  const token = await ctx.getCredential("google")
  if (!token) throw new Error("Google account not connected. Go to Settings → Integrations to connect Google.")
  return token
}

type ComposeParams = { to: string; subject: string; body: string; threadId?: string; inReplyTo?: string; references?: string }

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

// MIME types the browser can safely render in-tab. Everything else (Office
// docs, zips, octet-stream) must download — otherwise the browser opens it
// inline, fails to render, and a "Save" captures the viewer shell rather than
// the file (a docx saved this way is a corrupt 404-byte HTML stub).
const INLINE_MIME_PREFIXES = ["image/", "application/pdf", "text/"]

function dispositionFor(mime: string): "inline" | "attachment" {
  return INLINE_MIME_PREFIXES.some((p) => mime.startsWith(p)) ? "inline" : "attachment"
}

export const gmailPlugin: Plugin = {
  id: "gmail",
  name: "Emails",
  icon: "Mail",
  emoji: "✉️",
  components: { detail: "EmailThread" },
  auth: { integrationId: "google", scope: "user" },

  fieldSchema: [
    { id: "from", label: "From", type: "text", listRole: "subtitle" },
    { id: "subject", label: "Subject", type: "text", listRole: "title" },
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
    {
      id: "labels", label: "Labels", type: "multiselect",
      filter: { filterable: true },
      badge: { show: "if-set", variant: "outline" },
    },
  ],

  async query(filters, cursor, ctx) {
    const accessToken = await requireToken(ctx)

    // Build Gmail search query from filters. A free-text q searches ALL mail
    // (the escape hatch); otherwise scope to "in:inbox". Labels stay as Gmail
    // query terms.
    const parts: string[] = []
    if (filters.q) parts.push(filters.q)
    else parts.push("in:inbox")
    if (filters.labels) {
      for (const label of filters.labels.split(",")) {
        parts.push(`label:${label.trim()}`)
      }
    }
    const query = parts.join(" ")

    // Flags (starred/important/unread/…) are THREAD-level: a thread counts if
    // ANY message carries the label (Gmail unions labels over the thread — see
    // getThreadSummary). Gmail's `is:` operator is message-level, so
    // `in:inbox is:starred` drops threads whose star sits on a sent/older reply
    // (Gmail's inbox shows 16 starred but that query returns 8). Resolve it by
    // listing the scope's thread IDs (one cheap call), fetching their summaries
    // at high concurrency, and filtering on the union labelIds — the full match
    // set returns in one response so the list never stalls on a sparse first
    // page. (Listing every `is:<flag>` id would be far slower — is:starred ≈1750.)
    const FLAG_LABEL: Record<string, string> = {
      starred: "STARRED",
      important: "IMPORTANT",
      unread: "UNREAD",
      snoozed: "SNOOZED",
    }
    const flagLabels = (filters.flags || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((f) => FLAG_LABEL[f] ?? f.toUpperCase())

    type PluginItem = import("../../src/types/plugin.js").PluginItem
    if (flagLabels.length > 0) {
      const [scopeIds, userLabelMap] = await Promise.all([
        gmail.listThreadIds(accessToken, query),
        getUserLabelMapCached(accessToken),
      ])
      const scoped = await gmail.fetchBatched(scopeIds, (id) => gmail.getThreadSummary(accessToken, id), 20)
      const matches = scoped.filter((t) => flagLabels.every((l) => t.labelIds.includes(l)))
      matches.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
      return {
        items: matches.map((t) => addDerivedFields(t, userLabelMap)) as unknown as PluginItem[],
        nextCursor: undefined,
      }
    }

    const [result, userLabelMap] = await Promise.all([
      // Load the whole inbox in one page (like Studio's sessions list) so
      // scrolling has no mid-scroll pagination stalls; larger inboxes still
      // paginate via the cursor.
      gmail.searchThreads(accessToken, query, 200, cursor || undefined),
      getUserLabelMapCached(accessToken),
    ])
    return {
      items: result.threads.map((t) => addDerivedFields(t, userLabelMap)) as unknown as PluginItem[],
      nextCursor: result.nextPageToken ?? undefined,
    }
  },

  async getItem(threadId, ctx) {
    const accessToken = await requireToken(ctx)
    return await gmail.getThread(accessToken, threadId)
  },

  async mutate(id, action, payload, ctx) {
    const accessToken = await requireToken(ctx)
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
        const { to, subject, body, threadId, inReplyTo, references } = (payload ?? {}) as ComposeParams
        await gmail.sendMessage(accessToken, to, subject, body, threadId, inReplyTo, references)
        break
      }
      case "save-draft": {
        const { to, subject, body, threadId, inReplyTo, references } = (payload ?? {}) as ComposeParams
        await gmail.createDraft(accessToken, to, subject, body, threadId, inReplyTo, references)
        break
      }
      default:
        throw new Error(`Unknown Gmail action: ${action}`)
    }
  },

  filterOptions: {
    labels: async (ctx) => {
      const accessToken = await requireToken(ctx)
      const result = await gmail.getLabels(accessToken)
      return result.labels
        .filter((l) => l.type === "user")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((l) => l.name)
    },
  },

  routes(app, { getContext }) {
    // Attachment proxy
    app.get("/messages/:id/attachments/:attachmentId", async (c) => {
      const messageId = c.req.param("id")
      const attachmentId = c.req.param("attachmentId")
      const filename = c.req.query("filename")
      let data: Buffer
      try {
        // Token acquisition (refresh) and the Gmail fetch are both wrapped: an
        // expired/invalid OAuth token throws here, and we must not let any error
        // body get saved as the named file — return JSON with no file-named
        // Content-Disposition so the browser surfaces a failed request instead
        // of a corrupt download.
        const ctx = await getContext(c)
        const accessToken = await requireToken(ctx)
        data = await gmail.getAttachment(accessToken, messageId, attachmentId)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Attachment fetch failed"
        return c.json({ error: message }, 502)
      }
      const mime = filename ? mimeFromFilename(filename) : sniffMimeType(data)
      return new Response(new Uint8Array(data), {
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Type": mime,
          ...(filename ? { "Content-Disposition": `${dispositionFor(mime)}; filename="${filename}"` } : {}),
        },
      })
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
      const { to, subject, body, threadId, inReplyTo, references } = await c.req.json()
      const result = await gmail.sendMessage(accessToken, to, subject, body, threadId, inReplyTo, references)
      return c.json(result)
    })

    // Drafts
    app.post("/drafts", async (c) => {
      const ctx = await getContext(c)
      const accessToken = await requireToken(ctx)
      const { to, subject, body, threadId, inReplyTo, references } = await c.req.json()
      const result = await gmail.createDraft(accessToken, to, subject, body, threadId, inReplyTo, references)
      return c.json(result)
    })

    // Trash thread
    app.post("/threads/:id/trash", async (c) => {
      const ctx = await getContext(c)
      const accessToken = await requireToken(ctx)
      const id = c.req.param("id")
      await gmail.trashThread(accessToken, id)
      return c.json({ ok: true })
    })

    // Modify thread labels
    app.patch("/threads/:id/labels", async (c) => {
      const ctx = await getContext(c)
      const accessToken = await requireToken(ctx)
      const id = c.req.param("id")
      const { addLabelIds, removeLabelIds } = await c.req.json()
      await gmail.modifyThreadLabels(accessToken, id, addLabelIds || [], removeLabelIds || [])
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

  itemToContext(item) {
    const subject = String(item.subject || "")
    const from = String(item.from || "")
    const body = String(item.body || item.snippet || "")
    if (!subject && !body) return null
    const lower = from.toLowerCase()
    if (["noreply@", "no-reply@", "notifications@", "automated@", "donotreply@"].some((p) => lower.includes(p))) return null
    const date = String(item.date || "")
    return [
      "---",
      "type: email-thread",
      `thread-id: ${item.id}`,
      `subject: "${subject.replace(/"/g, '\\"')}"`,
      `date: ${date}`,
      "---",
      "",
      `# ${subject}`,
      `From: ${from}`,
      date ? `Date: ${date}` : "",
      "",
      body,
    ].filter(Boolean).join("\n")
  },
}

export default gmailPlugin
