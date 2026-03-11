import { Hono } from "hono"
import * as gmail from "../lib/gmail.js"
import { get as getCached, set as setCached, invalidate } from "../lib/cache.js"

const SYNC_TTL = 86_400_000 // 24h for historyId + thread list

type SyncState = {
  historyId: string
  threads: any[]
  nextPageToken: string | null
}

type ListResult = {
  messages: any[]
  nextPageToken: string | null
}


export const gmailRoutes = new Hono()

gmailRoutes.get("/messages", async (c) => {
  const query = c.req.query("q") || "in:inbox"
  const max = parseInt(c.req.query("max") || "20", 10)
  const pageToken = c.req.query("pageToken")

  // Incremental sync (first page only — paginated pages always do full fetch)
  if (!pageToken) {
    const syncKey = `gmail:sync:${query}:${max}`
    const syncState = getCached<SyncState>(syncKey)

    if (syncState?.historyId) {
      try {
        const history = await gmail.getHistory(syncState.historyId)

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
        const updatedThreads = await gmail.fetchBatched([...changedThreadIds], (id) => gmail.getThreadSummary(id))

        // Invalidate full thread caches so next thread open gets fresh data
        for (const id of changedThreadIds) invalidate(`gmail:thread:${id}`)

        const updatedMap = new Map(updatedThreads.map((t) => [t.id, t]))

        // Update or remove from existing list
        let threads = syncState.threads
          .map((t: any) => updatedMap.get(t.id) || t)
          .filter((t: any) => {
            const updated = updatedMap.get(t.id)
            // If this thread was changed, keep it only if still in inbox
            return updated ? updated.labelIds.includes("INBOX") : true
          })

        // Prepend new threads that are now in inbox but weren't in the list
        for (const t of updatedThreads) {
          if (!threads.find((m: any) => m.id === t.id) && t.labelIds.includes("INBOX")) {
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
        invalidate(`gmail:sync:${query}:${max}`)
      }
    }
  }

  // Full sync
  const result = await gmail.searchThreads(query, max, pageToken || undefined)
  const response: ListResult = { messages: result.threads, nextPageToken: result.nextPageToken }

  if (!pageToken && result.historyId) {
    const syncKey = `gmail:sync:${query}:${max}`
    setCached(
      syncKey,
      { historyId: result.historyId, threads: result.threads, nextPageToken: result.nextPageToken },
      SYNC_TTL,
    )
  }

  return c.json(response)
})

gmailRoutes.get("/messages/:id", async (c) => {
  const id = c.req.param("id")
  const message = await gmail.getMessage(id)
  return c.json(message)
})

gmailRoutes.get("/threads/:id", async (c) => {
  const id = c.req.param("id")
  const thread = await gmail.getThread(id)
  return c.json(thread)
})

gmailRoutes.get("/labels", async (c) => {
  const result = await gmail.getLabels()
  return c.json(result)
})

gmailRoutes.get("/messages/:id/attachments/:attachmentId", async (c) => {
  const messageId = c.req.param("id")
  const attachmentId = c.req.param("attachmentId")
  const data = await gmail.getAttachment(messageId, attachmentId)
  // Sniff image type from magic bytes
  const mime = sniffImageType(data)
  c.header("Cache-Control", "public, max-age=31536000, immutable")
  c.header("Content-Type", mime)
  return c.body(data)
})

function sniffImageType(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png"
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg"
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif"
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp" // RIFF header
  return "application/octet-stream"
}

gmailRoutes.post("/send", async (c) => {
  const { to, subject, body, threadId, inReplyTo } = await c.req.json()
  const result = await gmail.sendMessage(to, subject, body, threadId, inReplyTo)
  invalidate("gmail:sync:")
  if (threadId) invalidate(`gmail:thread:${threadId}`)
  return c.json(result)
})

gmailRoutes.post("/threads/:id/trash", async (c) => {
  const id = c.req.param("id")
  await gmail.trashThread(id)
  invalidate("gmail:sync:")
  invalidate(`gmail:thread:${id}`)
  return c.json({ ok: true })
})

gmailRoutes.patch("/threads/:id/labels", async (c) => {
  const id = c.req.param("id")
  const { addLabelIds, removeLabelIds } = await c.req.json()
  await gmail.modifyThreadLabels(id, addLabelIds || [], removeLabelIds || [])
  invalidate("gmail:sync:")
  invalidate(`gmail:thread:${id}`)
  return c.json({ ok: true })
})

gmailRoutes.patch("/messages/:id/labels", async (c) => {
  const { addLabelIds, removeLabelIds } = await c.req.json()
  await gmail.modifyLabels(c.req.param("id"), addLabelIds || [], removeLabelIds || [])
  return c.json({ ok: true })
})

gmailRoutes.post("/drafts", async (c) => {
  const { to, subject, body, threadId, inReplyTo } = await c.req.json()
  const result = await gmail.createDraft(to, subject, body, threadId, inReplyTo)
  return c.json(result)
})
