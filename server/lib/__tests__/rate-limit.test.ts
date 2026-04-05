import { describe, it, expect, beforeEach } from "vitest"
import { Hono } from "hono"
import { createRateLimitStore, rateLimit, getClientIp, _getDefaultStore } from "../rate-limit.js"

describe("createRateLimitStore", () => {
  it("allows up to max requests in the window", () => {
    const store = createRateLimitStore()
    const now = 1000
    const r1 = store.hit("k", 60_000, 3, now)
    const r2 = store.hit("k", 60_000, 3, now + 10)
    const r3 = store.hit("k", 60_000, 3, now + 20)
    expect(r1.allowed).toBe(true)
    expect(r2.allowed).toBe(true)
    expect(r3.allowed).toBe(true)
    expect(r3.remaining).toBe(0)
  })

  it("blocks requests beyond the limit", () => {
    const store = createRateLimitStore()
    const now = 1000
    store.hit("k", 60_000, 2, now)
    store.hit("k", 60_000, 2, now + 10)
    const blocked = store.hit("k", 60_000, 2, now + 20)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  it("resets after the window expires", () => {
    const store = createRateLimitStore()
    const now = 1000
    store.hit("k", 60_000, 1, now)
    const blocked = store.hit("k", 60_000, 1, now + 100)
    expect(blocked.allowed).toBe(false)
    const allowed = store.hit("k", 60_000, 1, now + 61_000) // after window
    expect(allowed.allowed).toBe(true)
  })

  it("tracks different keys independently", () => {
    const store = createRateLimitStore()
    const now = 1000
    store.hit("a", 60_000, 1, now)
    const aBlocked = store.hit("a", 60_000, 1, now + 10)
    const bAllowed = store.hit("b", 60_000, 1, now + 20)
    expect(aBlocked.allowed).toBe(false)
    expect(bAllowed.allowed).toBe(true)
  })

  it("reaper prunes expired buckets", () => {
    const store = createRateLimitStore()
    store.hit("a", 1000, 5, 0)
    store.hit("b", 1000, 5, 0)
    expect(store.size()).toBe(2)
    const removed = store.reap(5000)
    expect(removed).toBe(2)
    expect(store.size()).toBe(0)
  })

  it("returns retry-after in seconds", () => {
    const store = createRateLimitStore()
    const now = 10_000
    store.hit("k", 30_000, 1, now)
    const blocked = store.hit("k", 30_000, 1, now + 5000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBe(25)
  })
})

describe("rateLimit middleware", () => {
  beforeEach(() => {
    _getDefaultStore().clear()
  })

  it("allows requests under the limit", async () => {
    const app = new Hono()
    app.use("/test", rateLimit({ windowMs: 60_000, max: 3, label: "test-allow" }))
    app.get("/test", (c) => c.text("ok"))

    const res1 = await app.request("http://localhost/test", { headers: { "x-forwarded-for": "1.1.1.1" } })
    const res2 = await app.request("http://localhost/test", { headers: { "x-forwarded-for": "1.1.1.1" } })
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(res2.headers.get("X-RateLimit-Limit")).toBe("3")
    expect(res2.headers.get("X-RateLimit-Remaining")).toBe("1")
  })

  it("returns 429 when limit exceeded", async () => {
    const app = new Hono()
    app.use("/test", rateLimit({ windowMs: 60_000, max: 2, label: "test-block" }))
    app.get("/test", (c) => c.text("ok"))

    await app.request("http://localhost/test", { headers: { "x-forwarded-for": "2.2.2.2" } })
    await app.request("http://localhost/test", { headers: { "x-forwarded-for": "2.2.2.2" } })
    const blocked = await app.request("http://localhost/test", { headers: { "x-forwarded-for": "2.2.2.2" } })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("Retry-After")).toBeTruthy()
    const body = await blocked.json() as { error: string }
    expect(body.error).toBe("Too many requests")
  })

  it("uses custom keyFn", async () => {
    const app = new Hono()
    app.use("/test", rateLimit({
      windowMs: 60_000,
      max: 1,
      label: "test-custom",
      keyFn: (c) => c.req.header("x-user") ?? "anon",
    }))
    app.get("/test", (c) => c.text("ok"))

    // User A hits the limit
    await app.request("http://localhost/test", { headers: { "x-user": "alice" } })
    const aliceBlocked = await app.request("http://localhost/test", { headers: { "x-user": "alice" } })
    expect(aliceBlocked.status).toBe(429)

    // User B is tracked separately
    const bobAllowed = await app.request("http://localhost/test", { headers: { "x-user": "bob" } })
    expect(bobAllowed.status).toBe(200)
  })
})

describe("getClientIp", () => {
  it("extracts first IP from x-forwarded-for", () => {
    const c = { req: { header: (name: string) => name === "x-forwarded-for" ? "1.2.3.4, 5.6.7.8" : undefined } }
    expect(getClientIp(c as never)).toBe("1.2.3.4")
  })

  it("falls back to x-real-ip", () => {
    const c = { req: { header: (name: string) => name === "x-real-ip" ? "9.9.9.9" : undefined } }
    expect(getClientIp(c as never)).toBe("9.9.9.9")
  })

  it("returns 'unknown' if no IP headers", () => {
    const c = { req: { header: () => undefined } }
    expect(getClientIp(c as never)).toBe("unknown")
  })
})
