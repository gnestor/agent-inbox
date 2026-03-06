import { getDb } from "../db/schema.js"

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const db = getDb()
  const now = new Date().toISOString()
  const row = db.prepare(
    `SELECT data FROM api_cache WHERE key = ? AND expires_at > ?`,
  ).get(key, now) as { data: string } | undefined

  if (row) {
    return Promise.resolve(JSON.parse(row.data) as T)
  }

  return fn().then((data) => {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString()
    db.prepare(
      `INSERT OR REPLACE INTO api_cache (key, data, expires_at) VALUES (?, ?, ?)`,
    ).run(key, JSON.stringify(data), expiresAt)
    return data
  })
}

export function invalidate(keyPrefix: string) {
  const db = getDb()
  db.prepare(`DELETE FROM api_cache WHERE key LIKE ?`).run(`${keyPrefix}%`)
}

export function pruneExpired() {
  const db = getDb()
  db.prepare(`DELETE FROM api_cache WHERE expires_at <= ?`).run(new Date().toISOString())
}
