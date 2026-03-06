import { Hono } from "hono"
import * as gmail from "../lib/gmail.js"
import { cached, invalidate } from "../lib/cache.js"

const LIST_TTL = 60_000   // 1 min for message lists
const DETAIL_TTL = 300_000 // 5 min for individual threads
const LABEL_TTL = 600_000  // 10 min for labels

export const gmailRoutes = new Hono()

gmailRoutes.get("/messages", async (c) => {
  const query = c.req.query("q") || "in:inbox"
  const max = parseInt(c.req.query("max") || "20", 10)
  const pageToken = c.req.query("pageToken")
  const key = `gmail:messages:${query}:${max}:${pageToken || ""}`
  const result = await cached(key, LIST_TTL, () =>
    gmail.searchMessages(query, max, pageToken || undefined),
  )
  return c.json(result)
})

gmailRoutes.get("/messages/:id", async (c) => {
  const id = c.req.param("id")
  const message = await cached(`gmail:message:${id}`, DETAIL_TTL, () =>
    gmail.getMessage(id),
  )
  return c.json(message)
})

gmailRoutes.get("/threads/:id", async (c) => {
  const id = c.req.param("id")
  const thread = await cached(`gmail:thread:${id}`, DETAIL_TTL, () =>
    gmail.getThread(id),
  )
  return c.json(thread)
})

gmailRoutes.get("/labels", async (c) => {
  const result = await cached("gmail:labels", LABEL_TTL, () =>
    gmail.getLabels(),
  )
  return c.json(result)
})

gmailRoutes.patch("/messages/:id/labels", async (c) => {
  const { addLabelIds, removeLabelIds } = await c.req.json()
  await gmail.modifyLabels(c.req.param("id"), addLabelIds || [], removeLabelIds || [])
  invalidate("gmail:messages")
  invalidate(`gmail:message:${c.req.param("id")}`)
  return c.json({ ok: true })
})

gmailRoutes.post("/drafts", async (c) => {
  const { to, subject, body, threadId, inReplyTo } = await c.req.json()
  const result = await gmail.createDraft(to, subject, body, threadId, inReplyTo)
  if (threadId) invalidate(`gmail:thread:${threadId}`)
  return c.json(result)
})
