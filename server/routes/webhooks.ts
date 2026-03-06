import { Hono } from "hono"

export const webhookRoutes = new Hono()

// Notion integration webhook
webhookRoutes.post("/notion", async (c) => {
  // TODO Phase 3: Verify HMAC-SHA256 signature, process page.content_updated events
  const payload = await c.req.json()
  console.log("Notion webhook received:", JSON.stringify(payload).slice(0, 200))
  return c.json({ ok: true })
})

// Gmail push notification via Pub/Sub
webhookRoutes.post("/gmail", async (c) => {
  // TODO Phase 3: Process Pub/Sub message, fetch new email, check triage rules
  const payload = await c.req.json()
  console.log("Gmail webhook received:", JSON.stringify(payload).slice(0, 200))
  return c.json({ ok: true })
})

// Slack Events API
webhookRoutes.post("/slack", async (c) => {
  const payload = await c.req.json()

  // Handle Slack URL verification challenge
  if (payload.type === "url_verification") {
    return c.json({ challenge: payload.challenge })
  }

  // TODO Phase 3: Process message events, trigger sessions
  console.log("Slack webhook received:", JSON.stringify(payload).slice(0, 200))
  return c.json({ ok: true })
})
