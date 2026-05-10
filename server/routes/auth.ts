import { Hono } from "hono"
import { getCookie } from "hono/cookie"
import { sessionCookie, SESSION_COOKIE } from "@hammies/auth/server"
import { getClientId, verifyIdToken, getSession } from "../lib/auth.js"
import { getUserWorkspaces, resolveActiveWorkspace } from "../lib/workspace-scanner.js"
import { WORKSPACE_COOKIE } from "./workspaces.js"
import { AuthCallbackBody } from "../lib/schemas.js"
import type { ZodError } from "zod/v4"
import { rateLimit } from "../lib/rate-limit.js"

export { SESSION_COOKIE }

/** Extract first user-facing message from a Zod validation error */
function zodErrorMessage(err: ZodError): string {
  return err.issues[0]?.message ?? "Invalid request body"
}

export const authRoutes = new Hono()

authRoutes.get("/client-id", (c) => {
  return c.json({ clientId: getClientId() })
})

authRoutes.post("/callback", rateLimit({ windowMs: 60_000, max: 10, label: "auth-callback" }), async (c) => {
  let body: AuthCallbackBody
  try {
    body = AuthCallbackBody.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: zodErrorMessage(err as ZodError) }, 400)
  }
  const { credential } = body

  const { sessionToken, user } = await verifyIdToken(credential)
  c.header("Set-Cookie", sessionCookie(sessionToken, c.req.header("host")))
  return c.json(user)
})

authRoutes.get("/session", async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return c.json({ user: null })

  const session = await getSession(token)
  if (!session) return c.json({ user: null })

  // Resolve active workspace (handles auto-claim for first-time users)
  const activeWs = await resolveActiveWorkspace(session.user.email, getCookie(c, WORKSPACE_COOKIE))
  const workspaces = await getUserWorkspaces(session.user.email)

  return c.json({
    user: session.user,
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role })),
    activeWorkspace: activeWs
      ? { id: activeWs.id, name: activeWs.name, role: activeWs.role }
      : null,
  })
})

authRoutes.post("/logout", async (c) => {
  c.header("Set-Cookie", sessionCookie(null, c.req.header("host")))
  return c.json({ ok: true })
})
