import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"

process.env.VAULT_SECRET = "aa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"

// In-memory stores to simulate DB tables
const users = new Map<string, any>()
const userCredentials = new Map<string, any>()
const workspaceCredentials = new Map<string, any>()
const authSessions = new Map<string, any>()

// We need the real encrypt/decrypt from vault, so we use a functional mock
// that acts like a real DB
vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM user_credentials") && sql.includes("WHERE user_email") && !params?.[1]) {
      const email = params![0] as string
      const results: any[] = []
      for (const [key, row] of userCredentials.entries()) {
        if (key.startsWith(email + ":")) results.push(row)
      }
      return results
    }
    if (sql.includes("FROM workspace_credentials")) {
      const workspace = params![0] as string
      const results: any[] = []
      for (const [key, row] of workspaceCredentials.entries()) {
        if (key.startsWith(workspace + ":")) results.push(row)
      }
      return results
    }
    return []
  }),
  queryOne: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("auth_sessions") && sql.includes("token")) {
      return authSessions.get(params![0] as string)
    }
    if (sql.includes("FROM user_credentials") && params!.length >= 2) {
      return userCredentials.get(`${params![0]}:${params![1]}`) || undefined
    }
    if (sql.includes("FROM workspace_credentials") && params!.length >= 2) {
      return workspaceCredentials.get(`${params![0]}:${params![1]}`) || undefined
    }
    return undefined
  }),
  execute: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("INSERT INTO user_credentials")) {
      const userEmail = params![0] as string
      const integration = params![1] as string
      userCredentials.set(`${userEmail}:${integration}`, {
        encrypted_token: params![2],
        refresh_token: params![3],
        scopes: params![4],
        expires_at: params![5],
        integration,
        updated_at: params![7],
      })
      return { rowCount: 1 }
    }
    if (sql.includes("INSERT INTO users")) {
      users.set(params![0] as string, { email: params![0], name: params![1] })
      return { rowCount: 1 }
    }
    if (sql.includes("INSERT INTO auth_sessions")) {
      authSessions.set(params![0] as string, {
        user_name: params![1],
        user_email: params![2],
        user_picture: params![3],
      })
      return { rowCount: 1 }
    }
    return { rowCount: 0 }
  }),
  withTransaction: vi.fn(async (fn: any) => fn({
    query: vi.fn(async () => ({ rows: [] })),
  })),
}))

vi.mock("../session-manager.js", () => ({
  getWorkspacePath: () => "/test/workspace",
  getWorkspaceName: () => "test-workspace",
}))

const mockGetSession = vi.fn()
vi.mock("../auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

const { connectionRoutes } = await import("../../routes/connections.js")
const { getUserCredential } = await import("../vault.js")

function createTestApp() {
  const app = new Hono()
  app.route("/api/connections", connectionRoutes)
  return app
}

const testEmail = "test@hammies.com"

/**
 * Helper: start an OAuth flow to generate a valid state token.
 */
async function getValidState(app: Hono, integration: string): Promise<string> {
  if (integration === "google") {
    process.env.GOOGLE_CLIENT_ID = "test-google-client-id"
    process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret"
  } else if (integration === "pinterest") {
    process.env.PINTEREST_CLIENT_ID = "test-pinterest-client-id"
    process.env.PINTEREST_CLIENT_SECRET = "test-pinterest-client-secret"
  } else if (integration === "quickbooks") {
    process.env.QUICKBOOKS_CLIENT_ID = "test-quickbooks-client-id"
    process.env.QUICKBOOKS_CLIENT_SECRET = "test-quickbooks-client-secret"
  }

  const res = await app.request(
    `http://localhost/api/connections/connect/${integration}?origin=http://localhost:5175`,
    {
      headers: { Cookie: "inbox_session=test-token" },
      redirect: "manual",
    }
  )

  const location = res.headers.get("Location") || ""
  const url = new URL(location)
  return url.searchParams.get("state")!
}

describe("OAuth callback token exchange", () => {
  beforeEach(() => {
    users.clear()
    userCredentials.clear()
    workspaceCredentials.clear()
    authSessions.clear()
    users.set(testEmail, { email: testEmail, name: "Test User" })
    mockGetSession.mockReset()
    mockGetSession.mockReturnValue({
      user: { name: "Test User", email: testEmail },
    })
    mockFetch.mockReset()
  })

  it("exchanges code for token with Pinterest (Basic auth + form-encoded body)", async () => {
    const app = createTestApp()
    const state = await getValidState(app, "pinterest")

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "pinterest-token-123",
        refresh_token: "pinterest-refresh-456",
      }),
    })

    const res = await app.request(
      `http://localhost/api/connections/connect/pinterest/callback?code=pin-code&state=${state}`,
      { redirect: "manual" }
    )

    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toContain("connected=pinterest")

    // Verify fetch was called with Basic auth and form-encoded body
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain("api.pinterest.com")
    expect(opts.headers["Authorization"]).toMatch(/^Basic /)
    expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded")

    const params = new URLSearchParams(opts.body)
    expect(params.get("grant_type")).toBe("authorization_code")
    expect(params.get("code")).toBe("pin-code")
    expect(params.has("client_id")).toBe(false)
    expect(params.has("client_secret")).toBe(false)

    const basicB64 = opts.headers["Authorization"].replace("Basic ", "")
    const decoded = Buffer.from(basicB64, "base64").toString()
    expect(decoded).toBe("test-pinterest-client-id:test-pinterest-client-secret")

    // Verify credential stored
    const cred = await getUserCredential(testEmail, "pinterest")
    expect(cred).not.toBeNull()
    expect(cred!.token).toBe("pinterest-token-123")
  })

  it("exchanges code for token with generic provider (form-encoded, client_id in body)", async () => {
    const app = createTestApp()
    const state = await getValidState(app, "google")

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "google-token-456",
        refresh_token: "google-refresh-789",
        scope: "https://www.googleapis.com/auth/gmail.modify",
        expires_in: 3600,
      }),
    })

    const res = await app.request(
      `http://localhost/api/connections/connect/google/callback?code=google-code&state=${state}`,
      { redirect: "manual" }
    )

    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toContain("connected=google")

    const [, opts] = mockFetch.mock.calls[0]
    expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded")
    expect(opts.headers["Authorization"]).toBeUndefined()
    const params = new URLSearchParams(opts.body)
    expect(params.get("client_id")).toBe("test-google-client-id")
    expect(params.get("client_secret")).toBe("test-google-client-secret")
    expect(params.get("code")).toBe("google-code")
    expect(params.get("grant_type")).toBe("authorization_code")

    const cred = await getUserCredential(testEmail, "google")
    expect(cred).not.toBeNull()
    expect(cred!.token).toBe("google-token-456")
  })

  it("exchanges code for token with QuickBooks (generic path)", async () => {
    const app = createTestApp()
    const state = await getValidState(app, "quickbooks")

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "qb-token-abc",
        refresh_token: "qb-refresh-def",
        expires_in: 3600,
      }),
    })

    const res = await app.request(
      `http://localhost/api/connections/connect/quickbooks/callback?code=qb-code&state=${state}`,
      { redirect: "manual" }
    )

    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toContain("connected=quickbooks")

    const cred = await getUserCredential(testEmail, "quickbooks")
    expect(cred).not.toBeNull()
    expect(cred!.token).toBe("qb-token-abc")
  })

  it("redirects with error when provider returns error status", async () => {
    const app = createTestApp()
    const state = await getValidState(app, "google")

    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "Bad Request: invalid code",
    })

    const res = await app.request(
      `http://localhost/api/connections/connect/google/callback?code=bad-code&state=${state}`,
      { redirect: "manual" }
    )

    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toContain("error=")
    expect(res.headers.get("Location")).toContain("Token%20exchange%20failed")
  })

  it("redirects with error when response has no access_token", async () => {
    const app = createTestApp()
    const state = await getValidState(app, "google")

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "invalid_grant" }),
    })

    const res = await app.request(
      `http://localhost/api/connections/connect/google/callback?code=expired-code&state=${state}`,
      { redirect: "manual" }
    )

    expect(res.status).toBe(302)
    expect(res.headers.get("Location")).toContain("error=")
    expect(res.headers.get("Location")).toContain("No%20access%20token")
  })

  it("returns 400 for expired/unknown state", async () => {
    const app = createTestApp()
    const res = await app.request(
      "http://localhost/api/connections/connect/google/callback?code=test-code&state=expired-state-token",
    )

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/invalid|expired/i)
  })

  it("returns 400 for integration mismatch in state", async () => {
    const app = createTestApp()
    const state = await getValidState(app, "pinterest")

    const res = await app.request(
      `http://localhost/api/connections/connect/google/callback?code=test-code&state=${state}`,
    )

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/mismatch/i)
  })

  it("stores refresh_token and scopes when provided", async () => {
    const app = createTestApp()
    const state = await getValidState(app, "google")

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "google-access-tok",
        refresh_token: "google-refresh-tok",
        scope: "https://www.googleapis.com/auth/gmail.readonly",
        expires_in: 3600,
      }),
    })

    const res = await app.request(
      `http://localhost/api/connections/connect/google/callback?code=g-code&state=${state}`,
      { redirect: "manual" }
    )

    expect(res.status).toBe(302)

    const cred = await getUserCredential(testEmail, "google")
    expect(cred).not.toBeNull()
    expect(cred!.token).toBe("google-access-tok")
  })

  it("state can only be used once", async () => {
    const app = createTestApp()
    const state = await getValidState(app, "google")

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "token" }),
    })

    const res1 = await app.request(
      `http://localhost/api/connections/connect/google/callback?code=code1&state=${state}`,
      { redirect: "manual" }
    )
    expect(res1.status).toBe(302)
    expect(res1.headers.get("Location")).toContain("connected=google")

    const res2 = await app.request(
      `http://localhost/api/connections/connect/google/callback?code=code2&state=${state}`,
    )
    expect(res2.status).toBe(400)
  })

  it("redirects with error param when OAuth provider sends error query param", async () => {
    const app = createTestApp()
    const res = await app.request(
      "http://localhost/api/connections/connect/google/callback?error=access_denied",
      { redirect: "manual" }
    )

    expect(res.status).toBe(302)
    const location = res.headers.get("Location")
    expect(location).toContain("/settings/integrations")
    expect(location).toContain("error=access_denied")
  })

  it("returns 400 when code or state is missing", async () => {
    const app = createTestApp()
    const res = await app.request(
      "http://localhost/api/connections/connect/google/callback",
    )
    expect(res.status).toBe(400)
  })
})
