import { Hono } from "hono"
import * as gmail from "../lib/gmail.js"
import type { ThreadSummary } from "../lib/gmail.js"
import { get as getCached, set as setCached, invalidate } from "../lib/cache.js"
import { getUserCredential } from "../lib/vault.js"
import { refreshGoogleToken } from "../lib/credentials.js"
import type { AppEnv } from "../types/hono-env.js"

const SYNC_TTL = 86_400_000 // 24h for historyId + thread list

type SyncState = {
  historyId: string
  threads: ThreadSummary[]
  nextPageToken: string | null
}

type ListResult = {
  messages: ThreadSummary[]
  nextPageToken: string | null
}

/**
 * Resolve the current user's Google access token from the vault.
 * Returns null if the user hasn't connected Google.
 */
async function getUserGoogleToken(c: { get: <K extends keyof AppEnv["Variables"]>(key: K) => AppEnv["Variables"][K] }): Promise<string | null> {
  const userEmail = c.get("userEmail")
  if (!userEmail) return null
  const cred = getUserCredential(userEmail, "google")
  if (!cred?.refreshToken) return null
  return refreshGoogleToken(cred.refreshToken)
}

export const gmailRoutes = new Hono<AppEnv>()

// Middleware: require per-user Google credential on all gmail routes
gmailRoutes.use("*", async (c, next) => {
  const token = await getUserGoogleToken(c)
  if (!token) {
    return c.json(
      { error: "Google account not connected. Go to Settings → Integrations to connect Google." },
      403,
    )
  }
  c.set("googleAccessToken", token)
  await next()
})

gmailRoutes.get("/messages", async (c) => {
  const accessToken = c.get("googleAccessToken")
  const query = c.req.query("q") || "in:inbox"
  const max = parseInt(c.req.query("max") || "20", 10)
  const pageToken = c.req.query("pageToken")

  const userEmail = c.get("userEmail")

  // Incremental sync (first page only — paginated pages always do full fetch)
  // Scope cache key per user so different users don't share cached email lists
  if (!pageToken) {
    const syncKey = `gmail:sync:${userEmail}:${query}:${max}`
    const syncState = getCached<SyncState>(syncKey)

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
          // No changes — refresh cache TTL and return existing data
          const result: ListResult = {
            messages: syncState.threads,
            nextPageToken: syncState.nextPageToken,
          }
          setCached(syncKey, { ...syncState, historyId: newHistoryId }, SYNC_TTL)
          return c.json(result)
        }

        // Fetch updated thread summaries (batched)
        const updatedThreads = await gmail.fetchBatched([...changedThreadIds], (id) => gmail.getThreadSummary(accessToken, id))

        // Invalidate full thread caches so next thread open gets fresh data
        for (const id of changedThreadIds) invalidate(`gmail:thread:${id}`)

        const updatedMap = new Map(updatedThreads.map((t) => [t.id, t]))

        // Update or remove from existing list
        let threads = syncState.threads
          .map((t) => updatedMap.get(t.id) || t)
          .filter((t) => {
            const updated = updatedMap.get(t.id)
            // If this thread was changed, keep it only if still in inbox
            return updated ? updated.labelIds.includes("INBOX") : true
          })

        // Prepend new threads that are now in inbox but weren't in the list
        for (const t of updatedThreads) {
          if (!threads.find((m) => m.id === t.id) && t.labelIds.includes("INBOX")) {
            threads.unshift(t)
          }
        }

        const result: ListResult = { messages: threads, nextPageToken: syncState.nextPageToken }
        setCached(
          syncKey,
          { historyId: newHistoryId, threads, nextPageToken: syncState.nextPageToken },
          SYNC_TTL,
        )
        return c.json(result)
      } catch (e: any) {
        // 410 Gone = historyId too old; other errors → fall through to full sync
        console.warn("Incremental sync failed, falling back to full sync:", e.message)
        invalidate(`gmail:sync:${userEmail}:${query}:${max}`)
      }
    }
  }

  // Full sync
  const result = await gmail.searchThreads(accessToken, query, max, pageToken || undefined)
  const response: ListResult = { messages: result.threads, nextPageToken: result.nextPageToken }

  if (!pageToken && result.historyId) {
    const syncKey = `gmail:sync:${userEmail}:${query}:${max}`
    setCached(
      syncKey,
      { historyId: result.historyId, threads: result.threads, nextPageToken: result.nextPageToken },
      SYNC_TTL,
    )
  }

  return c.json(response)
})

gmailRoutes.get("/messages/:id", async (c) => {
  const accessToken = c.get("googleAccessToken")
  const id = c.req.param("id")
  const message = await gmail.getMessage(accessToken, id)
  return c.json(message)
})

gmailRoutes.get("/threads/:id", async (c) => {
  const accessToken = c.get("googleAccessToken")
  const id = c.req.param("id")
  const thread = await gmail.getThread(accessToken, id)
  return c.json(thread)
})

gmailRoutes.get("/labels", async (c) => {
  const accessToken = c.get("googleAccessToken")
  const result = await gmail.getLabels(accessToken)
  return c.json(result)
})

gmailRoutes.get("/messages/:id/attachments/:attachmentId", async (c) => {
  const accessToken = c.get("googleAccessToken")
  const messageId = c.req.param("id")
  const attachmentId = c.req.param("attachmentId")
  const data = await gmail.getAttachment(accessToken, messageId, attachmentId)
  const filename = c.req.query("filename")
  const mime = filename ? mimeFromFilename(filename) : sniffMimeType(data)
  c.header("Cache-Control", "public, max-age=31536000, immutable")
  c.header("Content-Type", mime)
  if (filename) {
    c.header("Content-Disposition", `inline; filename="${filename}"`)
  }
  return c.body(data)
})

function mimeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase()
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
    txt: "text/plain",
    zip: "application/zip",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
  }
  return map[ext || ""] || "application/octet-stream"
}

function sniffMimeType(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png"
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg"
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif"
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp" // RIFF header
  if (buf[0] === 0x25 && buf[1] === 0x50) return "application/pdf" // %PDF
  return "application/octet-stream"
}

gmailRoutes.get("/signature", async (c) => {
  const accessToken = c.get("googleAccessToken")
  const signature = await gmail.getSignature(accessToken)
  return c.json({ signature })
})

gmailRoutes.post("/send", async (c) => {
  const accessToken = c.get("googleAccessToken")
  const { to, subject, body, threadId, inReplyTo } = await c.req.json()
  const signature = await gmail.getSignature(accessToken)
  const result = await gmail.sendMessage(accessToken, to, subject, body, threadId, inReplyTo, signature)
  invalidate("gmail:sync:")
  if (threadId) invalidate(`gmail:thread:${threadId}`)
  return c.json(result)
})

gmailRoutes.post("/threads/:id/trash", async (c) => {
  const accessToken = c.get("googleAccessToken")
  const id = c.req.param("id")
  await gmail.trashThread(accessToken, id)
  invalidate("gmail:sync:")
  invalidate(`gmail:thread:${id}`)
  return c.json({ ok: true })
})

gmailRoutes.patch("/threads/:id/labels", async (c) => {
  const accessToken = c.get("googleAccessToken")
  const id = c.req.param("id")
  const { addLabelIds, removeLabelIds } = await c.req.json()
  await gmail.modifyThreadLabels(accessToken, id, addLabelIds || [], removeLabelIds || [])
  invalidate("gmail:sync:")
  invalidate(`gmail:thread:${id}`)
  return c.json({ ok: true })
})

gmailRoutes.patch("/messages/:id/labels", async (c) => {
  const accessToken = c.get("googleAccessToken")
  const { addLabelIds, removeLabelIds } = await c.req.json()
  await gmail.modifyLabels(accessToken, c.req.param("id"), addLabelIds || [], removeLabelIds || [])
  return c.json({ ok: true })
})

gmailRoutes.post("/drafts", async (c) => {
  const accessToken = c.get("googleAccessToken")
  const { to, subject, body, threadId, inReplyTo } = await c.req.json()
  const signature = await gmail.getSignature(accessToken)
  const result = await gmail.createDraft(accessToken, to, subject, body, threadId, inReplyTo, signature)
  return c.json(result)
})
