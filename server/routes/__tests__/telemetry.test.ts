import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"

// Capture appended JSONL lines instead of touching the filesystem.
const appended: { file: string; data: string }[] = []
vi.mock("fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  appendFile: vi.fn(async (file: string, data: string) => {
    appended.push({ file: String(file), data: String(data) })
  }),
}))

const { telemetryRoutes } = await import("../telemetry.js")

function createApp() {
  const app = new Hono()
  app.route("/api/telemetry", telemetryRoutes)
  return app
}

describe("telemetry routes", () => {
  beforeEach(() => {
    appended.length = 0
  })

  it("Scenario: Telemetry endpoints are unauthenticated and best-effort — append JSONL and always return 204", async () => {
    const app = createApp()

    const hb = await app.request("http://localhost/api/telemetry/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
      body: JSON.stringify({ ts: 123, route: "/inbox" }),
    })
    expect(hb.status).toBe(204)

    const crash = await app.request("http://localhost/api/telemetry/crash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "crash", detectedAt: 456 }),
    })
    expect(crash.status).toBe(204)

    // Both wrote one JSONL line each, terminated by a newline.
    expect(appended.length).toBe(2)
    const hbLine = appended[0]
    expect(hbLine.file).toContain("heartbeat.jsonl")
    expect(hbLine.data.endsWith("\n")).toBe(true)
    const hbEntry = JSON.parse(hbLine.data.trim()) as Record<string, unknown>
    expect(hbEntry).toMatchObject({ ts: 123, route: "/inbox", ip: "1.2.3.4" })
    expect(hbEntry.receivedAt).toBeTypeOf("string")

    const crashLine = appended[1]
    expect(crashLine.file).toContain("crash.jsonl")
    expect(JSON.parse(crashLine.data.trim())).toMatchObject({ type: "crash", detectedAt: 456 })
  })

  it("caps payloads at 16 KB and still returns 204 without appending", async () => {
    const app = createApp()
    const huge = "x".repeat(17 * 1024)
    const res = await app.request("http://localhost/api/telemetry/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blob: huge }),
    })
    // Best-effort: never fail loudly even when the body is rejected.
    expect(res.status).toBe(204)
    expect(appended.length).toBe(0)
  })

  it("returns 204 even when the body is not valid JSON", async () => {
    const app = createApp()
    const res = await app.request("http://localhost/api/telemetry/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    })
    expect(res.status).toBe(204)
    expect(appended.length).toBe(0)
  })
})
