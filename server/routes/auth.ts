import { Hono } from "hono"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import { getClientId, verifyIdToken, getSession, deleteSession } from "../lib/auth.js"

export const SESSION_COOKIE = "inbox_session"

export const authRoutes = new Hono()

authRoutes.get("/client-id", (c) => {
  return c.json({ clientId: getClientId() })
})

authRoutes.post("/callback", async (c) => {
  const { credential } = await c.req.json()
  if (!credential) return c.json({ error: "Missing credential" }, 400)

  const { sessionToken, user } = await verifyIdToken(credential)
  setCookie(c, SESSION_COOKIE, sessionToken, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 7,
  })
  return c.json(user)
})

authRoutes.get("/session", (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return c.json({ user: null })

  const session = getSession(token)
  if (!session) return c.json({ user: null })

  return c.json({ user: session.user })
})

authRoutes.post("/logout", (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    deleteSession(token)
    deleteCookie(c, SESSION_COOKIE, { path: "/" })
  }
  return c.json({ ok: true })
})
