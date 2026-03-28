import { randomBytes } from "crypto"
import { execute, queryOne } from "../db/pool.js"

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
  const now = new Date().toISOString()

  await execute(
    `INSERT INTO users (email, name, picture, created_at, last_login_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(email) DO UPDATE SET name = EXCLUDED.name, picture = EXCLUDED.picture, last_login_at = EXCLUDED.last_login_at`,
    [user.email, user.name, user.picture || null, now, now],
  )

  await execute(
    `INSERT INTO auth_sessions (token, user_name, user_email, user_picture, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionToken, user.name, user.email, user.picture || null, now],
  )

  return { sessionToken, user }
}

export async function getSession(
  token: string,
): Promise<{ user: { name: string; email: string; picture?: string } } | undefined> {
  const row = await queryOne<{
    user_name: string
    user_email: string
    user_picture: string | null
  }>(`SELECT user_name, user_email, user_picture FROM auth_sessions WHERE token = $1`, [token])

  if (!row) return undefined
  return {
    user: { name: row.user_name, email: row.user_email, picture: row.user_picture || undefined },
  }
}

export async function deleteSession(token: string) {
  await execute(`DELETE FROM auth_sessions WHERE token = $1`, [token])
}
