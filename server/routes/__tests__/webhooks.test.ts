import { describe, it, expect, vi, afterEach } from "vitest"
import { Hono } from "hono"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { webhookRoutes } from "../webhooks.js"

function createApp() {
  const app = new Hono()
  app.route("/api/webhooks", webhookRoutes)
  return app
}

function postJson(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
    expect(await res.json()).toEqual({ challenge: "abc123" })
  })
})

describe("webhooks — generic ingress", () => {
  it("Scenario: Any other payload is acknowledged", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const app = createApp()
    const res = await postJson(app, "/api/webhooks/notion", { event: "page.updated", foo: "bar" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    // Logs the payload tagged with the plugin id.
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[webhook:notion]"),
      expect.any(String),
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
    expect(await res.json()).toEqual({ challenge: "no-cookie" })
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
