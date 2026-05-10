import {
  signSession,
  verifySession,
  verifyGoogleIdToken,
  SESSION_COOKIE as HAMMIES_SESSION_COOKIE,
} from "@hammies/auth/server"
import { execute } from "../db/pool.js"

export const SESSION_COOKIE = HAMMIES_SESSION_COOKIE

export function getClientId(): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw new Error("Missing GOOGLE_CLIENT_ID in inbox .env")
  return clientId
}

export interface SessionUser {
  name: string
  email: string
  picture?: string
}

/** Verify a Google id_token, upsert the user row, and mint a JWT session token. */
export async function verifyIdToken(credential: string): Promise<{
  sessionToken: string
  user: SessionUser
}> {
  const payload = await verifyGoogleIdToken(credential)
  const user: SessionUser = {
    name: payload.name || payload.email,
    email: payload.email,
    picture: payload.picture,
  }
  const now = new Date().toISOString()
  await execute(
    `INSERT INTO users (email, name, picture, created_at, last_login_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(email) DO UPDATE SET name = EXCLUDED.name, picture = EXCLUDED.picture, last_login_at = EXCLUDED.last_login_at`,
    [user.email, user.name, user.picture || null, now, now],
  )
  const sessionToken = await signSession({
    sub: payload.sub,
    email: user.email,
    name: user.name,
    picture: user.picture,
  })
  return { sessionToken, user }
}

/** Verify a JWT session cookie and return the user it identifies. */
export async function getSession(token: string): Promise<{ user: SessionUser } | undefined> {
  try {
    const s = await verifySession(token)
    return { user: { name: s.name || s.email, email: s.email, picture: s.picture } }
  } catch {
    return undefined
  }
}

/** No-op: JWT sessions are stateless. Cookie deletion handles logout. */
export async function deleteSession(_token: string): Promise<void> {}
