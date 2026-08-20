import { Hono } from "hono"
import { z } from "zod"
import {
  assertFreshWebhookTimestamp,
  decodeVerifiedWebhookPayload,
  verifyWebhookHmac,
} from "@hammies/contracts/webhook"
import { CONTRACT_VERSION } from "@hammies/contracts"
import { claimWebhookEvent } from "../db/webhook-replay.js"

const SlackUrlVerificationSchema = z.object({
  type: z.literal("url_verification"),
  challenge: z.string().min(1).max(4_096),
}).passthrough()

const SlackEventSchema = z.object({
  type: z.literal("event_callback"),
  event_id: z.string().min(1),
  event: z.object({ type: z.string().min(1) }).passthrough(),
}).passthrough()

const GenericWebhookSchema = z.record(z.string(), z.unknown())

export interface WebhookRouteOptions {
  slackSigningSecret?: () => string | undefined
  genericSigningSecret?: () => string | undefined
  now?: () => number
  claimEvent?: (eventId: string, now: number) => Promise<boolean>
}

function invalidSignature(c: { json: (body: object, status: 401) => Response }): Response {
  return c.json({
    contractVersion: CONTRACT_VERSION,
    error: {
      code: "invalid_webhook_signature",
      message: "Webhook signature verification failed",
    },
  }, 401)
}

export function createWebhookRoutes(
  options: WebhookRouteOptions = {},
): Hono {
  const routes = new Hono()
  const slackSecret = options.slackSigningSecret ?? (() => process.env.SLACK_SIGNING_SECRET)
  const genericSecret = options.genericSigningSecret ?? (() => process.env.INBOX_WEBHOOK_SECRET)
  const now = options.now ?? Date.now
  const claimEvent = options.claimEvent ?? claimWebhookEvent

  routes.post("/:pluginId", async (c) => {
    const pluginId = c.req.param("pluginId")
    const rawBody = await c.req.text()
    const timestamp = c.req.header(
      pluginId === "slack" ? "X-Slack-Request-Timestamp" : "X-Hammies-Timestamp",
    )
    if (!timestamp) return invalidSignature(c)

    try {
      assertFreshWebhookTimestamp(timestamp, { now: now() })
    } catch {
      return invalidSignature(c)
    }

    if (pluginId === "slack") {
      const secret = slackSecret()
      const provided = c.req.header("X-Slack-Signature")
      if (!secret || !provided?.startsWith("v0=")) return invalidSignature(c)
      const verified = await verifyWebhookHmac(
        `v0:${timestamp}:${rawBody}`,
        secret,
        provided.slice(3),
        "hex",
      )
      if (!verified) return invalidSignature(c)

      const input = decodeVerifiedWebhookPayload(
        z.union([SlackUrlVerificationSchema, SlackEventSchema]),
        rawBody,
        "slack-webhook@1",
      )
      if (input.type === "url_verification") {
        return c.json({
          contractVersion: CONTRACT_VERSION,
          challenge: input.challenge,
        })
      }
      if (!await claimEvent(`slack:${input.event_id}`, now())) {
        return c.json({
          contractVersion: CONTRACT_VERSION,
          outcome: "duplicate",
        })
      }
      return c.json({
        contractVersion: CONTRACT_VERSION,
        outcome: "unsupported-event",
        eventType: input.event.type,
      }, 202)
    }

    const secret = genericSecret()
    const signature = c.req.header("X-Hammies-Signature")
    const eventId = c.req.header("X-Hammies-Event-Id")
    if (!secret || !signature || !eventId) return invalidSignature(c)
    const verified = await verifyWebhookHmac(rawBody, secret, signature, "hex")
    if (!verified) return invalidSignature(c)
    decodeVerifiedWebhookPayload(GenericWebhookSchema, rawBody, `${pluginId}-webhook@1`)
    if (!await claimEvent(`${pluginId}:${eventId}`, now())) {
      return c.json({
        contractVersion: CONTRACT_VERSION,
        outcome: "duplicate",
      })
    }
    return c.json({
      contractVersion: CONTRACT_VERSION,
      outcome: "unsupported-event",
    }, 202)
  })

  return routes
}

export const webhookRoutes = createWebhookRoutes()
