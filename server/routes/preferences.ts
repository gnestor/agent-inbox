import { Hono } from "hono"
import { getCookie } from "hono/cookie"
import { getDb } from "../db/schema.js"
import { getSession } from "../lib/auth.js"
import { SESSION_COOKIE } from "./auth.js"

export const preferencesRoutes = new Hono()

function getUserEmail(c: any): string | null {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const session = getSession(token)
  return session?.user.email ?? null
}

// GET /preferences — returns all preferences as { [key]: value }
preferencesRoutes.get("/", (c) => {
  const email = getUserEmail(c)
  if (!email) return c.json({ error: "Unauthorized" }, 401)

  const db = getDb()
  const rows = db
    .prepare(`SELECT key, value FROM user_preferences WHERE user_email = ?`)
    .all(email) as { key: string; value: string }[]

  const prefs: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      prefs[row.key] = JSON.parse(row.value)
    } catch {
      prefs[row.key] = row.value
    }
  }
  return c.json(prefs)
})

// PUT /preferences — body: { key: string, value: any }
preferencesRoutes.put("/", async (c) => {
  const email = getUserEmail(c)
  if (!email) return c.json({ error: "Unauthorized" }, 401)

  const { key, value } = await c.req.json()
  if (!key) return c.json({ error: "Missing key" }, 400)

  const db = getDb()
  db.prepare(
    `INSERT OR REPLACE INTO user_preferences (user_email, key, value, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(email, key, JSON.stringify(value), new Date().toISOString())

  return c.json({ ok: true })
})

// PUT /preferences/batch — body: { prefs: { [key]: value } }
preferencesRoutes.put("/batch", async (c) => {
  const email = getUserEmail(c)
  if (!email) return c.json({ error: "Unauthorized" }, 401)

  const { prefs } = await c.req.json()
  if (!prefs || typeof prefs !== "object") return c.json({ error: "Missing prefs" }, 400)

  const db = getDb()
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO user_preferences (user_email, key, value, updated_at) VALUES (?, ?, ?, ?)`,
  )
  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(prefs)) {
      stmt.run(email, key, JSON.stringify(value), now)
    }
  })
  tx()

  return c.json({ ok: true })
})
