import { vi, describe, it, expect, beforeEach } from "vitest"

// dbHolder is populated by the vi.mock factory (called when cache.ts imports schema.ts).
// Declaring it at module scope (before the dynamic import) ensures it's initialised.
const dbHolder: { db: ReturnType<import("better-sqlite3").default> | null } = { db: null }

vi.mock("../../db/schema.js", async () => {
  const Database = (await import("better-sqlite3")).default
  const db = new Database(":memory:")
  db.prepare(
    `CREATE TABLE IF NOT EXISTS api_cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`,
  ).run()
  dbHolder.db = db
  return { getDb: () => dbHolder.db }
})

// Dynamic import resolves AFTER the mock is registered (avoids ESM static-import hoisting)
const { get, set, cached, invalidate, pruneExpired, getStale, staleWhileRevalidate } =
  await import("../cache.js")

describe("cache", () => {
  beforeEach(() => {
    dbHolder.db!.prepare("DELETE FROM api_cache").run()
  })

  // ── get ───────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("returns null for a missing key", () => {
      expect(get("missing")).toBeNull()
    })

    it("returns null for an expired entry", () => {
      const past = new Date(Date.now() - 5000).toISOString()
      dbHolder.db!.prepare("INSERT INTO api_cache VALUES (?, ?, ?)").run("exp", '"v"', past)
      expect(get("exp")).toBeNull()
    })

    it("returns the parsed value for a valid (non-expired) entry", () => {
      const future = new Date(Date.now() + 60_000).toISOString()
      dbHolder.db!.prepare("INSERT INTO api_cache VALUES (?, ?, ?)").run("k", '"hello"', future)
      expect(get("k")).toBe("hello")
    })

    it("deserialises objects correctly", () => {
      const future = new Date(Date.now() + 60_000).toISOString()
      dbHolder
        .db!.prepare("INSERT INTO api_cache VALUES (?, ?, ?)")
        .run("obj", JSON.stringify({ a: 1 }), future)
      expect(get<{ a: number }>("obj")).toEqual({ a: 1 })
    })
  })

  // ── set ───────────────────────────────────────────────────────────────────

  describe("set", () => {
    it("stores a value retrievable via get", () => {
      set("k1", { foo: "bar" }, 60_000)
      expect(get<{ foo: string }>("k1")).toEqual({ foo: "bar" })
    })

    it("overwrites an existing key", () => {
      set("k2", "first", 60_000)
      set("k2", "second", 60_000)
      expect(get("k2")).toBe("second")
    })

    it("entry with negative TTL is immediately expired", () => {
      // Date.now() + (-5000) = 5 seconds in the past → already expired
      set("gone", "value", -5_000)
      expect(get("gone")).toBeNull()
    })
  })

  // ── cached ────────────────────────────────────────────────────────────────

  describe("cached", () => {
    it("calls fn on a cache miss and returns its result", async () => {
      const fn = vi.fn().mockResolvedValue({ n: 42 })
      const result = await cached("c1", 60_000, fn)
      expect(fn).toHaveBeenCalledOnce()
      expect(result).toEqual({ n: 42 })
    })

    it("serves the cached value on a hit without calling fn again", async () => {
      await cached("c2", 60_000, () => Promise.resolve("original"))
      const fn = vi.fn().mockResolvedValue("new")
      const result = await cached("c2", 60_000, fn)
      expect(fn).not.toHaveBeenCalled()
      expect(result).toBe("original")
    })

    it("persists the fn result so subsequent get() calls return it", async () => {
      await cached("c3", 60_000, () => Promise.resolve({ nested: true }))
      expect(get<{ nested: boolean }>("c3")).toEqual({ nested: true })
    })
  })

  // ── invalidate ────────────────────────────────────────────────────────────

  describe("invalidate", () => {
    it("deletes all keys matching the given prefix", () => {
      set("prefix:a", 1, 60_000)
      set("prefix:b", 2, 60_000)
      set("other:c", 3, 60_000)
      invalidate("prefix:")
      expect(get("prefix:a")).toBeNull()
      expect(get("prefix:b")).toBeNull()
    })

    it("leaves keys that do not match the prefix", () => {
      set("prefix:a", 1, 60_000)
      set("other:c", 3, 60_000)
      invalidate("prefix:")
      expect(get("other:c")).toBe(3)
    })
  })

  // ── getStale ──────────────────────────────────────────────────────────────

  describe("getStale", () => {
    it("returns null for a completely missing key", () => {
      expect(getStale("missing")).toBeNull()
    })

    it("returns data even when the entry is expired (ignores TTL)", () => {
      const past = new Date(Date.now() - 10_000).toISOString()
      dbHolder.db!.prepare("INSERT INTO api_cache VALUES (?, ?, ?)").run("stale", '"old"', past)
      expect(getStale("stale")).toBe("old")
    })

    it("returns data for a fresh (non-expired) entry too", () => {
      set("fresh", "new", 60_000)
      expect(getStale("fresh")).toBe("new")
    })
  })

  // ── staleWhileRevalidate ──────────────────────────────────────────────────

  describe("staleWhileRevalidate", () => {
    it("calls fn and returns result when no cache exists (cold start)", async () => {
      const fn = vi.fn().mockResolvedValue(42)
      const result = await staleWhileRevalidate("swr1", 60_000, fn)
      expect(fn).toHaveBeenCalledOnce()
      expect(result).toBe(42)
      expect(get("swr1")).toBe(42) // persisted for next request
    })

    it("returns fresh cached value without calling fn", async () => {
      set("swr2", "cached", 60_000)
      const fn = vi.fn()
      const result = await staleWhileRevalidate("swr2", 60_000, fn)
      expect(fn).not.toHaveBeenCalled()
      expect(result).toBe("cached")
    })

    it("returns stale value immediately when cache is expired", async () => {
      const past = new Date(Date.now() - 5_000).toISOString()
      dbHolder.db!.prepare("INSERT INTO api_cache VALUES (?, ?, ?)").run("swr3", '"stale"', past)
      const fn = vi.fn().mockResolvedValue("fresh")
      const result = await staleWhileRevalidate("swr3", 60_000, fn)
      expect(result).toBe("stale") // stale returned immediately
    })

    it("updates the cache in the background after returning stale data", async () => {
      const past = new Date(Date.now() - 5_000).toISOString()
      dbHolder.db!.prepare("INSERT INTO api_cache VALUES (?, ?, ?)").run("swr4", '"stale"', past)
      const fn = vi.fn().mockResolvedValue("fresh")
      await staleWhileRevalidate("swr4", 60_000, fn)
      // Background Promise resolves in the next microtask tick
      await Promise.resolve()
      await Promise.resolve()
      expect(get("swr4")).toBe("fresh")
    })

    it("does not launch duplicate background refreshes for the same key", async () => {
      const past = new Date(Date.now() - 5_000).toISOString()
      dbHolder.db!.prepare("INSERT INTO api_cache VALUES (?, ?, ?)").run("swr5", '"stale"', past)
      const fn = vi.fn().mockResolvedValue("fresh")
      // Two concurrent calls with the same stale key
      await Promise.all([
        staleWhileRevalidate("swr5", 60_000, fn),
        staleWhileRevalidate("swr5", 60_000, fn),
      ])
      await Promise.resolve()
      await Promise.resolve()
      expect(fn).toHaveBeenCalledOnce() // only one background refresh
    })
  })

  // ── pruneExpired ──────────────────────────────────────────────────────────

  describe("pruneExpired", () => {
    it("removes expired rows and leaves valid ones", () => {
      const past = new Date(Date.now() - 1000).toISOString()
      dbHolder.db!.prepare("INSERT INTO api_cache VALUES (?, ?, ?)").run("dead", '"d"', past)
      set("alive", "v", 60_000)

      pruneExpired()

      expect(get("alive")).toBe("v")
      const row = dbHolder.db!.prepare("SELECT * FROM api_cache WHERE key = ?").get("dead")
      expect(row).toBeUndefined()
    })
  })
})
