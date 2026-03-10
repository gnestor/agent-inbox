import { randomBytes } from "crypto"
import { getDb } from "../db/schema.js"

export function getClientId(): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw new Error("Missing GOOGLE_CLIENT_ID in inbox .env")
  return clientId
}

export async function verifyIdToken(credential: string): Promise<{
  sessionToken: string
  user: { name: string; email: string; picture?: string }
}> {
  const clientId = getClientId()

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ID token verification failed: ${text}`)
  }

  const payload = await res.json()

  if (payload.aud !== clientId) {
    throw new Error("ID token audience mismatch")
  }

  const user = {
    name: payload.name || payload.email,
    email: payload.email,
    picture: payload.picture,
  }

  const sessionToken = randomBytes(32).toString("hex")
  const db = getDb()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO users (email, name, picture, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, picture = excluded.picture, last_login_at = excluded.last_login_at`,
  ).run(user.email, user.name, user.picture || null, now, now)

  db.prepare(
    `INSERT INTO auth_sessions (token, user_name, user_email, user_picture, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionToken, user.name, user.email, user.picture || null, now)

  return { sessionToken, user }
}

export function getSession(
  token: string,
): { user: { name: string; email: string; picture?: string } } | undefined {
  const db = getDb()
  const row = db
    .prepare(`SELECT user_name, user_email, user_picture FROM auth_sessions WHERE token = ?`)
    .get(token) as
    | { user_name: string; user_email: string; user_picture: string | null }
    | undefined

  if (!row) return undefined
  return {
    user: { name: row.user_name, email: row.user_email, picture: row.user_picture || undefined },
  }
}

export function deleteSession(token: string) {
  const db = getDb()
  db.prepare(`DELETE FROM auth_sessions WHERE token = ?`).run(token)
}
