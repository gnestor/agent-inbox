import { Hono } from "hono"
import { isRecord } from "../lib/schemas.js"

export const webhookRoutes = new Hono()

// Generic webhook endpoint — routes to the plugin identified by :pluginId
// Each plugin can handle its own webhook payloads via plugin.webhookHandler()
webhookRoutes.post("/:pluginId", async (c) => {
  const pluginId = c.req.param("pluginId")
  const payload: unknown = await c.req.json()

  // Handle Slack URL verification challenge
  if (isRecord(payload) && payload.type === "url_verification" && typeof payload.challenge === "string") {
    return c.json({ challenge: payload.challenge })
  }

  // TODO: Route to plugin's webhook handler when implemented
  console.log(`[webhook:${pluginId}] received:`, JSON.stringify(payload).slice(0, 200))
  return c.json({ ok: true })
})
