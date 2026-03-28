import { vi, describe, it, expect, beforeEach } from "vitest"

// In-memory store to simulate a real cache table
const store = new Map<string, { data: string; expires_at: string }>()

vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("SELECT data FROM api_cache") && sql.includes("expires_at >")) {
      const key = params![0] as string
      const now = params![1] as string
      const entry = store.get(key)
      if (entry && entry.expires_at > now) return [{ data: entry.data }]
      return []
    }
    if (sql.includes("SELECT data FROM api_cache") && !sql.includes("expires_at >")) {
      const key = params![0] as string
      const entry = store.get(key)
      if (entry) return [{ data: entry.data }]
      return []
    }
    return []
  }),
  queryOne: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("SELECT data FROM api_cache") && sql.includes("expires_at >")) {
      const key = params![0] as string
      const now = params![1] as string
      const entry = store.get(key)
      if (entry && entry.expires_at > now) return { data: entry.data }
      return undefined
    }
    if (sql.includes("SELECT data FROM api_cache") && !sql.includes("expires_at >")) {
      const key = params![0] as string
      const entry = store.get(key)
      if (entry) return { data: entry.data }
      return undefined
    }
    return undefined
  }),
  execute: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("INSERT INTO api_cache")) {
      const key = params![0] as string
      const data = params![1] as string
      const expires_at = params![2] as string
      store.set(key, { data, expires_at })
      return { rowCount: 1 }
    }
    if (sql.includes("DELETE FROM api_cache") && sql.includes("LIKE")) {
      const prefix = (params![0] as string).replace(/%$/, "")
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key)
      }
      return { rowCount: 1 }
    }
    if (sql.includes("DELETE FROM api_cache") && sql.includes("expires_at <=")) {
      const now = params![0] as string
      for (const [key, entry] of store.entries()) {
        if (entry.expires_at <= now) store.delete(key)
      }
      return { rowCount: 1 }
    }
    return { rowCount: 0 }
  }),
}))

// Dynamic import resolves AFTER the mock is registered
const { get, set, cached, invalidate, pruneExpired, getStale, staleWhileRevalidate } =
  await import("../cache.js")

describe("cache", () => {
  beforeEach(() => {
    store.clear()
  })

  // ── get ───────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("returns null for a missing key", async () => {
      expect(await get("missing")).toBeNull()
    })

    it("returns null for an expired entry", async () => {
      const past = new Date(Date.now() - 5000).toISOString()
      store.set("exp", { data: '"v"', expires_at: past })
      expect(await get("exp")).toBeNull()
    })

    it("returns the parsed value for a valid (non-expired) entry", async () => {
      const future = new Date(Date.now() + 60_000).toISOString()
      store.set("k", { data: '"hello"', expires_at: future })
      expect(await get("k")).toBe("hello")
    })

    it("deserialises objects correctly", async () => {
      const future = new Date(Date.now() + 60_000).toISOString()
      store.set("obj", { data: JSON.stringify({ a: 1 }), expires_at: future })
      expect(await get<{ a: number }>("obj")).toEqual({ a: 1 })
    })
  })

  // ── set ───────────────────────────────────────────────────────────────────

  describe("set", () => {
    it("stores a value retrievable via get", async () => {
      await set("k1", { foo: "bar" }, 60_000)
      expect(await get<{ foo: string }>("k1")).toEqual({ foo: "bar" })
    })

    it("overwrites an existing key", async () => {
      await set("k2", "first", 60_000)
      await set("k2", "second", 60_000)
      expect(await get("k2")).toBe("second")
    })

    it("entry with negative TTL is immediately expired", async () => {
      // Date.now() + (-5000) = 5 seconds in the past → already expired
      await set("gone", "value", -5_000)
      expect(await get("gone")).toBeNull()
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
      expect(await get<{ nested: boolean }>("c3")).toEqual({ nested: true })
    })
  })

  // ── invalidate ────────────────────────────────────────────────────────────

  describe("invalidate", () => {
    it("deletes all keys matching the given prefix", async () => {
      await set("prefix:a", 1, 60_000)
      await set("prefix:b", 2, 60_000)
      await set("other:c", 3, 60_000)
      await invalidate("prefix:")
      expect(await get("prefix:a")).toBeNull()
      expect(await get("prefix:b")).toBeNull()
    })

    it("leaves keys that do not match the prefix", async () => {
      await set("prefix:a", 1, 60_000)
      await set("other:c", 3, 60_000)
      await invalidate("prefix:")
      expect(await get("other:c")).toBe(3)
    })
  })

  // ── getStale ──────────────────────────────────────────────────────────────

  describe("getStale", () => {
    it("returns null for a completely missing key", async () => {
      expect(await getStale("missing")).toBeNull()
    })

    it("returns data even when the entry is expired (ignores TTL)", async () => {
      const past = new Date(Date.now() - 10_000).toISOString()
      store.set("stale", { data: '"old"', expires_at: past })
      expect(await getStale("stale")).toBe("old")
    })

    it("returns data for a fresh (non-expired) entry too", async () => {
      await set("fresh", "new", 60_000)
      expect(await getStale("fresh")).toBe("new")
    })
  })

  // ── staleWhileRevalidate ──────────────────────────────────────────────────

  describe("staleWhileRevalidate", () => {
    it("calls fn and returns result when no cache exists (cold start)", async () => {
      const fn = vi.fn().mockResolvedValue(42)
      const result = await staleWhileRevalidate("swr1", 60_000, fn)
      expect(fn).toHaveBeenCalledOnce()
      expect(result).toBe(42)
      expect(await get("swr1")).toBe(42) // persisted for next request
    })

    it("returns fresh cached value without calling fn", async () => {
      await set("swr2", "cached", 60_000)
      const fn = vi.fn()
      const result = await staleWhileRevalidate("swr2", 60_000, fn)
      expect(fn).not.toHaveBeenCalled()
      expect(result).toBe("cached")
    })

    it("returns stale value immediately when cache is expired", async () => {
      const past = new Date(Date.now() - 5_000).toISOString()
      store.set("swr3", { data: '"stale"', expires_at: past })
      const fn = vi.fn().mockResolvedValue("fresh")
      const result = await staleWhileRevalidate("swr3", 60_000, fn)
      expect(result).toBe("stale") // stale returned immediately
    })

    it("updates the cache in the background after returning stale data", async () => {
      const past = new Date(Date.now() - 5_000).toISOString()
      store.set("swr4", { data: '"stale"', expires_at: past })
      const fn = vi.fn().mockResolvedValue("fresh")
      await staleWhileRevalidate("swr4", 60_000, fn)
      // Background Promise resolves in the next microtask tick
      await Promise.resolve()
      await Promise.resolve()
      expect(await get("swr4")).toBe("fresh")
    })

    it("does not launch duplicate background refreshes for the same key", async () => {
      const past = new Date(Date.now() - 5_000).toISOString()
      store.set("swr5", { data: '"stale"', expires_at: past })
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
    it("removes expired rows and leaves valid ones", async () => {
      const past = new Date(Date.now() - 1000).toISOString()
      store.set("dead", { data: '"d"', expires_at: past })
      await set("alive", "v", 60_000)

      await pruneExpired()

      expect(await get("alive")).toBe("v")
      expect(store.has("dead")).toBe(false)
    })
  })
})
