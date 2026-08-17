import { describe, it, expect, vi, afterEach } from "vitest"
import { Hono } from "hono"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createWebhookRoutes } from "../webhooks.js"

const NOW_SECONDS = 1_785_196_800
const SLACK_SECRET = "fixture-slack-signing-secret"
const GENERIC_SECRET = "fixture-generic-signing-secret-32-bytes"

type ClaimEvent = (eventId: string, now: number) => Promise<boolean>

function createReplayStore(): ClaimEvent {
  const claims = new Map<string, number>()
  return async (eventId, now) => {
    const expiresAt = claims.get(eventId)
    if (expiresAt !== undefined && expiresAt > now) return false
    claims.set(eventId, now + 86_400_000)
    return true
  }
}

function createApp(claimEvent: ClaimEvent = createReplayStore()) {
  const app = new Hono()
  app.route("/api/webhooks", createWebhookRoutes({
    slackSigningSecret: () => SLACK_SECRET,
    genericSigningSecret: () => GENERIC_SECRET,
    now: () => NOW_SECONDS * 1_000,
    claimEvent,
  }))
  return app
}

async function signature(body: string, secret: string, prefix = ""): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)))
  return prefix + Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function postJson(app: Hono, path: string, body: unknown, eventId: string = crypto.randomUUID()) {
  const rawBody = JSON.stringify(body)
  const isSlack = path.endsWith("/slack")
  const timestamp = String(NOW_SECONDS)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (isSlack) {
    headers["X-Slack-Request-Timestamp"] = timestamp
    headers["X-Slack-Signature"] = await signature(
      `v0:${timestamp}:${rawBody}`,
      SLACK_SECRET,
      "v0=",
    )
  } else {
    headers["X-Hammies-Timestamp"] = timestamp
    headers["X-Hammies-Event-Id"] = eventId
    headers["X-Hammies-Signature"] = await signature(rawBody, GENERIC_SECRET)
  }
  return app.request(path, {
    method: "POST",
    headers,
    body: rawBody,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("webhooks — URL verification", () => {
  it("Scenario: Slack `url_verification` payloads are echoed", async () => {
    const app = createApp()
    const res = await postJson(app, "/api/webhooks/slack", {
      type: "url_verification",
      challenge: "abc123",
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ contractVersion: 1, challenge: "abc123" })
  })
})

describe("webhooks — generic ingress", () => {
  it("Scenario: Unsupported signed events are explicitly acknowledged", async () => {
    const app = createApp()
    const res = await postJson(app, "/api/webhooks/notion", { event: "page.updated", foo: "bar" })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({
      contractVersion: 1,
      outcome: "unsupported-event",
    })
  })

  it("Scenario: Replay claims survive process and instance boundaries", async () => {
    const replayStore = createReplayStore()
    const firstInstance = createApp(replayStore)
    const secondInstance = createApp(replayStore)
    const eventId = "shared-event-1"

    const accepted = await postJson(
      firstInstance,
      "/api/webhooks/notion",
      { event: "page.updated" },
      eventId,
    )
    const duplicate = await postJson(
      secondInstance,
      "/api/webhooks/notion",
      { event: "page.updated" },
      eventId,
    )

    expect(accepted.status).toBe(202)
    expect(await duplicate.json()).toEqual({ contractVersion: 1, outcome: "duplicate" })
  })

  it("Scenario: The durable replay store decides whether an event is new", async () => {
    const claimEvent = vi.fn<ClaimEvent>().mockResolvedValue(false)
    const app = createApp(claimEvent)

    const response = await postJson(
      app,
      "/api/webhooks/notion",
      { event: "page.updated" },
      "already-claimed-event",
    )

    expect(await response.json()).toEqual({ contractVersion: 1, outcome: "duplicate" })
    expect(claimEvent).toHaveBeenCalledWith(
      "notion:already-claimed-event",
      NOW_SECONDS * 1_000,
    )
  })

  it("Scenario: Auth middleware does not gate this route", async () => {
    // No inbox_session cookie is supplied; the route still processes the request.
    const app = createApp()
    const res = await postJson(app, "/api/webhooks/slack", {
      type: "url_verification",
      challenge: "no-cookie",
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ contractVersion: 1, challenge: "no-cookie" })
  })

  it("Scenario: Invalid signatures are rejected before JSON parsing", async () => {
    const app = createApp()
    const res = await app.request("/api/webhooks/slack", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Slack-Request-Timestamp": String(NOW_SECONDS),
        "X-Slack-Signature": "v0=invalid",
      },
      body: "{not-json",
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({
      contractVersion: 1,
      error: { code: "invalid_webhook_signature" },
    })
  })
})

describe("webhooks — mount point", () => {
  it("Scenario: Mounted at `/api/webhooks`", () => {
    // The server mounts webhookRoutes at /api/webhooks and the CSRF middleware
    // exempts the same prefix. Assert both against the server bootstrap source.
    const index = readFileSync(resolve(import.meta.dirname, "../../index.ts"), "utf8")
    expect(index).toContain('app.route("/api/webhooks", webhookRoutes)')
    expect(index).toMatch(/exemptPaths:\s*\[[^\]]*"\/api\/webhooks"/)
  })
})
