import { getDb } from "../db/schema.js"

export function get<T>(key: string): T | null {
  const db = getDb()
  const now = new Date().toISOString()
  const row = db
    .prepare(`SELECT data FROM api_cache WHERE key = ? AND expires_at > ?`)
    .get(key, now) as { data: string } | undefined
  return row ? (JSON.parse(row.data) as T) : null
}

export function set<T>(key: string, data: T, ttlMs: number): void {
  const db = getDb()
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  db.prepare(`INSERT OR REPLACE INTO api_cache (key, data, expires_at) VALUES (?, ?, ?)`).run(
    key,
    JSON.stringify(data),
    expiresAt,
  )
}

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const db = getDb()
  const now = new Date().toISOString()
  const row = db
    .prepare(`SELECT data FROM api_cache WHERE key = ? AND expires_at > ?`)
    .get(key, now) as { data: string } | undefined

  if (row) {
    return Promise.resolve(JSON.parse(row.data) as T)
  }

  return fn().then((data) => {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString()
    db.prepare(`INSERT OR REPLACE INTO api_cache (key, data, expires_at) VALUES (?, ?, ?)`).run(
      key,
      JSON.stringify(data),
      expiresAt,
    )
    return data
  })
}

export function invalidate(keyPrefix: string) {
  const db = getDb()
  db.prepare(`DELETE FROM api_cache WHERE key LIKE ?`).run(`${keyPrefix}%`)
}

/** Like get() but returns data even when the TTL has expired. */
export function getStale<T>(key: string): T | null {
  const db = getDb()
  const row = db.prepare(`SELECT data FROM api_cache WHERE key = ?`).get(key) as
    | { data: string }
    | undefined
  return row ? (JSON.parse(row.data) as T) : null
}

/**
 * Stale-while-revalidate: always return data quickly, refresh in the background.
 *
 * - Fresh cache hit → return immediately, no fetch
 * - Stale (expired) → return stale immediately, trigger one background refresh
 * - No data at all  → await fn() (unavoidable cold start, data is then cached)
 *
 * Duplicate background refreshes for the same key are deduplicated via inFlight.
 */
const inFlight = new Map<string, Promise<unknown>>()

export async function staleWhileRevalidate<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  // Fast path: fresh data exists
  const fresh = get<T>(key)
  if (fresh !== null) return fresh

  // Stale path: expired data exists — return it and refresh in background
  const stale = getStale<T>(key)
  if (stale !== null) {
    if (!inFlight.has(key)) {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 30_000),
      )
      const p = Promise.race([fn(), timeout])
        .then((data) => {
          set(key, data as T, ttlMs)
          inFlight.delete(key)
        })
        .catch((err) => {
          console.error(`[cache] background refresh failed for "${key}":`, err)
          inFlight.delete(key)
        })
      inFlight.set(key, p)
    }
    return stale
  }

  // Cold path: no data — must wait for the first fetch
  const data = await fn()
  set(key, data, ttlMs)
  return data
}

export function pruneExpired() {
  const db = getDb()
  db.prepare(`DELETE FROM api_cache WHERE expires_at <= ?`).run(new Date().toISOString())
}
