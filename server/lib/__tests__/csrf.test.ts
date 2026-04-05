import { describe, it, expect } from "vitest"
import { Hono } from "hono"
import { csrfProtection, extractOrigin } from "../csrf.js"

function createApp(opts: { allowedOrigins: string[]; exemptPaths?: string[] }) {
  const app = new Hono()
  app.use("*", csrfProtection(opts))
  app.get("/x", (c) => c.json({ ok: true }))
  app.post("/x", (c) => c.json({ ok: true }))
  app.patch("/x", (c) => c.json({ ok: true }))
  app.delete("/x", (c) => c.json({ ok: true }))
  app.post("/oauth-callback/google", (c) => c.json({ ok: true }))
  return app
}

describe("csrfProtection", () => {
  const app = createApp({
    allowedOrigins: ["http://localhost:5175", "https://inbox.example.com"],
    exemptPaths: ["/oauth-callback/"],
  })

  it("allows GET without Origin", async () => {
    const res = await app.request("http://localhost/x")
    expect(res.status).toBe(200)
  })

  it("allows HEAD without Origin", async () => {
    const res = await app.request("http://localhost/x", { method: "HEAD" })
    expect(res.status).toBe(200)
  })

  it("allows POST with matching Origin", async () => {
    const res = await app.request("http://localhost/x", {
      method: "POST",
      headers: { origin: "http://localhost:5175" },
    })
    expect(res.status).toBe(200)
  })

  it("blocks POST with foreign Origin (403)", async () => {
    const res = await app.request("http://localhost/x", {
      method: "POST",
      headers: { origin: "https://evil.com" },
    })
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe("Forbidden origin")
  })

  it("blocks POST without Origin or Referer (403)", async () => {
    const res = await app.request("http://localhost/x", { method: "POST" })
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe("Missing origin")
  })

  it("falls back to Referer when Origin missing", async () => {
    const res = await app.request("http://localhost/x", {
      method: "POST",
      headers: { referer: "http://localhost:5175/some/path" },
    })
    expect(res.status).toBe(200)
  })

  it("blocks PATCH/DELETE with foreign origin", async () => {
    const patch = await app.request("http://localhost/x", {
      method: "PATCH",
      headers: { origin: "https://evil.com" },
    })
    expect(patch.status).toBe(403)

    const del = await app.request("http://localhost/x", {
      method: "DELETE",
      headers: { origin: "https://evil.com" },
    })
    expect(del.status).toBe(403)
  })

  it("exempts configured paths", async () => {
    const res = await app.request("http://localhost/oauth-callback/google", {
      method: "POST",
      headers: { origin: "https://accounts.google.com" },
    })
    expect(res.status).toBe(200)
  })
})

describe("extractOrigin", () => {
  it("extracts origin from full URL", () => {
    expect(extractOrigin("http://localhost:5175/some/path?q=1")).toBe("http://localhost:5175")
  })

  it("returns null for invalid URL", () => {
    expect(extractOrigin("not-a-url")).toBe(null)
  })

  it("returns null for null/undefined/empty input", () => {
    expect(extractOrigin(null)).toBe(null)
    expect(extractOrigin(undefined)).toBe(null)
    expect(extractOrigin("")).toBe(null)
  })
})
