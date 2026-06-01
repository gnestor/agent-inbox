import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"

// --- Mocks --------------------------------------------------------------

const mockVerifyIdToken = vi.fn()
const mockGetSession = vi.fn()
vi.mock("../../lib/auth.js", () => ({
  getClientId: () => {
    if (!process.env.GOOGLE_CLIENT_ID) throw new Error("Missing GOOGLE_CLIENT_ID")
    return process.env.GOOGLE_CLIENT_ID
  },
  verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  SESSION_COOKIE: "hammies_session",
}))

vi.mock("@hammies/auth/server", () => ({
  SESSION_COOKIE: "hammies_session",
  sessionCookie: (token: string | null) =>
    token === null
      ? "hammies_session=; Max-Age=0; Path=/"
      : `hammies_session=${token}; Path=/; HttpOnly; SameSite=Lax`,
}))

vi.mock("../../lib/workspace-scanner.js", () => ({
  getUserWorkspaces: vi.fn(async () => []),
  resolveActiveWorkspace: vi.fn(async () => null),
}))

vi.mock("../workspaces.js", () => ({ WORKSPACE_COOKIE: "inbox_workspace" }))

const { authRoutes } = await import("../auth.js")
const { _getDefaultStore } = await import("../../lib/rate-limit.js")

function createApp() {
  const app = new Hono()
  app.route("/api/auth", authRoutes)
  return app
}

describe("auth routes", () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset()
    mockGetSession.mockReset()
    _getDefaultStore().clear()
    process.env.GOOGLE_CLIENT_ID = "client-id-123"
  })

  it("Scenario: Client fetches OAuth client ID — GET /client-id returns the configured clientId", async () => {
    const app = createApp()
    const res = await app.request("http://localhost/api/auth/client-id")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ clientId: "client-id-123" })
  })

  it("Scenario: Validation rejects malformed callback bodies — POST /callback returns 400 and never calls verify", async () => {
    const app = createApp()
    const res = await app.request("http://localhost/api/auth/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "9.0.0.1" },
      body: JSON.stringify({ notCredential: "x" }),
    })
    expect(res.status).toBe(400)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it("Scenario: Successful sign-in upserts user and mints JWT — POST /callback verifies, sets cookie, returns user", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      sessionToken: "minted.jwt",
      user: { name: "Alice", email: "alice@test.com", picture: null },
    })
    const app = createApp()
    const res = await app.request("http://localhost/api/auth/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "9.0.0.2" },
      body: JSON.stringify({ credential: "google-id-token" }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ email: "alice@test.com" })
    expect(res.headers.get("Set-Cookie")).toContain("hammies_session=minted.jwt")
  })

  it("Scenario: Sign-in callback is rate-limited — 11th callback in the window returns 429", async () => {
    mockVerifyIdToken.mockResolvedValue({
      sessionToken: "t",
      user: { name: "A", email: "a@test.com", picture: null },
    })
    const app = createApp()
    const ip = "9.9.9.9"
    let last: Response | undefined
    for (let i = 0; i < 11; i++) {
      last = await app.request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ credential: "tok" }),
      })
    }
    expect(last!.status).toBe(429)
  })

  it("Scenario: `GET /api/auth/session` with a valid cookie — returns user + workspaces + activeWorkspace", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { name: "Bob", email: "bob@test.com" } })
    const app = createApp()
    const res = await app.request("http://localhost/api/auth/session", {
      headers: { Cookie: "hammies_session=valid.jwt" },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { user: { email: string }; workspaces: unknown[] }
    expect(body.user.email).toBe("bob@test.com")
    expect(Array.isArray(body.workspaces)).toBe(true)
  })

  it("Scenario: `GET /api/auth/session` with no or invalid cookie — returns { user: null } with 200", async () => {
    const app = createApp()
    const noCookie = await app.request("http://localhost/api/auth/session")
    expect(noCookie.status).toBe(200)
    expect(await noCookie.json()).toEqual({ user: null })

    mockGetSession.mockResolvedValueOnce(undefined)
    const badCookie = await app.request("http://localhost/api/auth/session", {
      headers: { Cookie: "hammies_session=garbage" },
    })
    expect(badCookie.status).toBe(200)
    expect(await badCookie.json()).toEqual({ user: null })
  })

  it("Scenario: Logout clears the cookie — POST /logout clears the cookie and returns { ok: true } idempotently", async () => {
    const app = createApp()
    const res = await app.request("http://localhost/api/auth/logout", { method: "POST" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0")
  })
})

// The /api/* auth middleware is wired inline in server/index.ts (not exported),
// so these tests reconstruct the exact same middleware contract using the same
// collaborators (getCookie, getSession, runWithRequestContext) and assert the
// gating + post-auth request-context correlation behaviour.
describe("auth middleware (/api/* gate)", () => {
  beforeEach(() => {
    mockGetSession.mockReset()
  })

  async function buildGatedApp() {
    const { getCookie } = await import("hono/cookie")
    const { getSession, SESSION_COOKIE } = await import("../../lib/auth.js")
    const { runWithRequestContext, getRequestContext, createLogger } = await import(
      "@hammies/frontend/lib/serverLogger"
    )
    const log = createLogger("test-auth-mw")

    const app = new Hono()
    app.use("/api/*", async (c, next) => {
      const token = getCookie(c, SESSION_COOKIE)
      if (!token) return c.json({ error: "Unauthorized" }, 401)
      const session = await getSession(token)
      if (!session) return c.json({ error: "Unauthorized" }, 401)
      await runWithRequestContext({ requestId: "req-1", userEmail: session.user.email }, () => next())
    })
    app.get("/api/protected", (c) => {
      // Post-auth log call: userEmail is auto-injected by AsyncLocalStorage.
      log.info("inside handler")
      const ctx = getRequestContext()
      return c.json({ userEmail: ctx?.userEmail ?? null })
    })
    return app
  }

  it("Scenario: Auth middleware gates all `/api/*` routes — 401 without or with an invalid session cookie", async () => {
    const app = await buildGatedApp()

    const noCookie = await app.request("http://localhost/api/protected")
    expect(noCookie.status).toBe(401)
    expect(await noCookie.json()).toEqual({ error: "Unauthorized" })

    mockGetSession.mockResolvedValueOnce(undefined)
    const badCookie = await app.request("http://localhost/api/protected", {
      headers: { Cookie: "hammies_session=garbage" },
    })
    expect(badCookie.status).toBe(401)
  })

  it("Scenario: Request correlation includes userEmail post-auth — context carries the authenticated user's email", async () => {
    mockGetSession.mockResolvedValueOnce({ user: { name: "Bob", email: "bob@test.com" } })
    const app = await buildGatedApp()
    const res = await app.request("http://localhost/api/protected", {
      headers: { Cookie: "hammies_session=valid.jwt" },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userEmail: "bob@test.com" })
  })
})
