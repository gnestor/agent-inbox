import { query, queryOne, execute } from "../db/pool.js"

export async function get<T>(key: string): Promise<T | null> {
  const now = new Date().toISOString()
  const row = await queryOne<{ data: string }>(
    `SELECT data FROM api_cache WHERE key = $1 AND expires_at > $2`,
    [key, now],
  )
  return row ? (JSON.parse(row.data) as T) : null
}

export async function set<T>(key: string, data: T, ttlMs: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  await execute(
    `INSERT INTO api_cache (key, data, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
    [key, JSON.stringify(data), expiresAt],
  )
}

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = new Date().toISOString()
  const row = await queryOne<{ data: string }>(
    `SELECT data FROM api_cache WHERE key = $1 AND expires_at > $2`,
    [key, now],
  )

  if (row) {
    return JSON.parse(row.data) as T
  }

  const data = await fn()
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  await execute(
    `INSERT INTO api_cache (key, data, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
    [key, JSON.stringify(data), expiresAt],
  )
  return data
}

export async function invalidate(keyPrefix: string) {
  await execute(`DELETE FROM api_cache WHERE key LIKE $1`, [`${keyPrefix}%`])
}

/** Like get() but returns data even when the TTL has expired. */
export async function getStale<T>(key: string): Promise<T | null> {
  const row = await queryOne<{ data: string }>(
    `SELECT data FROM api_cache WHERE key = $1`,
    [key],
  )
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
  const fresh = await get<T>(key)
  if (fresh !== null) return fresh

  // Stale path: expired data exists — return it and refresh in background
  const stale = await getStale<T>(key)
  if (stale !== null) {
    if (!inFlight.has(key)) {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 30_000),
      )
      const p = Promise.race([fn(), timeout])
        .then(async (data) => {
          await set(key, data as T, ttlMs)
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
  await set(key, data, ttlMs)
  return data
}

export async function pruneExpired() {
  await execute(`DELETE FROM api_cache WHERE expires_at <= $1`, [new Date().toISOString()])
}
