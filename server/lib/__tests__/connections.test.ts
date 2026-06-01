import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"

process.env.VAULT_SECRET = "aa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"

// In-memory stores to simulate DB tables
const users = new Map<string, any>()
const userCredentials = new Map<string, any>()
const workspaceCredentials = new Map<string, any>()

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
    if (sql.includes("DELETE FROM user_credentials")) {
      const email = params![0] as string
      const integration = params![1] as string
      userCredentials.delete(`${email}:${integration}`)
      return { rowCount: 1 }
    }
    if (sql.includes("INSERT INTO workspace_credentials")) {
      const workspace = params![0] as string
      const integration = params![1] as string
      workspaceCredentials.set(`${workspace}:${integration}`, {
        encrypted_token: params![2],
        integration,
        updated_at: params![4],
      })
      return { rowCount: 1 }
    }
    return { rowCount: 0 }
  }),
  withTransaction: vi.fn(async (fn: any) => fn({
    query: vi.fn(async () => ({ rows: [] })),
  })),
}))

// Mock session-manager to provide a workspace path
vi.mock("../session-manager.js", () => ({
  getWorkspacePath: () => "/test/workspace",
  getWorkspaceName: () => "test-workspace",
}))

// Mock auth — provide a controllable session lookup
const mockGetSession = vi.fn()
vi.mock("../auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

const { connectionRoutes } = await import("../../routes/connections.js")
const { storeUserCredential, storeWorkspaceCredential } = await import("../vault.js")

function createTestApp() {
  const app = new Hono()
  app.route("/api/connections", connectionRoutes)
  return app
}

function makeRequest(app: Hono, path: string, options: RequestInit = {}) {
  return app.request(path, {
    headers: {
      Cookie: "hammies_session=test-token",
      ...options.headers,
    },
    ...options,
  })
}

describe("connection routes", () => {
  const testEmail = "test@hammies.com"

  beforeEach(() => {
    users.clear()
    userCredentials.clear()
    workspaceCredentials.clear()
    users.set(testEmail, { email: testEmail, name: "Test User" })
    mockGetSession.mockReset()
    mockGetSession.mockReturnValue({
      user: { name: "Test User", email: testEmail, picture: undefined },
    })
  })

  describe("GET /api/connections", () => {
    it("Scenario: `GET /connections` reports connected status without leaking tokens — returns all integrations with connection status", async () => {
      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections")
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.integrations).toBeDefined()
      expect(Array.isArray(data.integrations)).toBe(true)
      expect(data.integrations.length).toBeGreaterThanOrEqual(6)

      for (const integration of data.integrations) {
        expect(integration.connected).toBe(false)
        expect(integration.id).toBeTruthy()
        expect(integration.name).toBeTruthy()
      }
    })

    it("shows user integrations as connected when credentials exist", async () => {
      await storeUserCredential(testEmail, "google", { token: "test-token" })

      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections")
      const data = await res.json()

      const google = data.integrations.find((i: any) => i.id === "google")
      expect(google.connected).toBe(true)

      const pinterest = data.integrations.find((i: any) => i.id === "pinterest")
      expect(pinterest.connected).toBe(false)
    })

    it("shows workspace integrations as connected when credentials exist", async () => {
      await storeWorkspaceCredential("test-workspace", "shopify", "shop-token")

      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections")
      const data = await res.json()

      const shopify = data.integrations.find((i: any) => i.id === "shopify")
      expect(shopify.connected).toBe(true)
    })

    it("returns 401 when not authenticated", async () => {
      mockGetSession.mockReturnValue(undefined)

      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections")
      expect(res.status).toBe(401)
    })
  })

  describe("GET /api/connections/connect/:integration", () => {
    it("returns 404 for unknown integration", async () => {
      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections/connect/unknown")
      expect(res.status).toBe(404)
    })

    it("returns 400 for non-OAuth integration", async () => {
      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections/connect/shopify")
      expect(res.status).toBe(400)
    })

    it("returns 500 when client ID env is not set", async () => {
      delete process.env.GOOGLE_CLIENT_ID
      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections/connect/google")
      expect(res.status).toBe(500)
    })

    it("Scenario: `GET /connections/connect/:integration` starts an OAuth flow — redirects to OAuth provider when configured", async () => {
      process.env.GOOGLE_CLIENT_ID = "test-google-client-id"
      process.env.GOOGLE_CLIENT_SECRET = "test-google-secret"
      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections/connect/google", {
        redirect: "manual",
      })
      expect(res.status).toBe(302)
      const location = res.headers.get("Location")
      expect(location).toContain("https://accounts.google.com/o/oauth2/v2/auth")
      expect(location).toContain("client_id=test-google-client-id")
      expect(location).toContain("state=")
      delete process.env.GOOGLE_CLIENT_ID
      delete process.env.GOOGLE_CLIENT_SECRET
    })

    it("returns 401 when not authenticated", async () => {
      mockGetSession.mockReturnValue(undefined)
      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections/connect/notion")
      expect(res.status).toBe(401)
    })
  })

  describe("GET /api/connections/connect/:integration/callback", () => {
    it("returns 400 when code or state is missing", async () => {
      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections/connect/notion/callback")
      expect(res.status).toBe(400)
    })

    it("returns 400 for invalid state", async () => {
      const app = createTestApp()
      const res = await makeRequest(
        app,
        "http://localhost/api/connections/connect/notion/callback?code=test-code&state=invalid-state"
      )
      expect(res.status).toBe(400)
    })

    it("redirects with error when provider returns error", async () => {
      const app = createTestApp()
      const res = await makeRequest(
        app,
        "http://localhost/api/connections/connect/notion/callback?error=access_denied",
        { redirect: "manual" }
      )
      expect(res.status).toBe(302)
      const location = res.headers.get("Location")
      expect(location).toContain("/settings/integrations")
      expect(location).toContain("error=access_denied")
    })
  })

  describe("DELETE /api/connections/:integration", () => {
    it("Scenario: `DELETE /connections/:integration` removes user credential only — disconnects a user integration", async () => {
      await storeUserCredential(testEmail, "google", { token: "test-token" })

      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections/google", {
        method: "DELETE",
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)

      // Verify it's disconnected
      const listRes = await makeRequest(app, "http://localhost/api/connections")
      const listData = await listRes.json()
      const google = listData.integrations.find((i: any) => i.id === "google")
      expect(google.connected).toBe(false)
    })

    it("returns 404 for unknown integration", async () => {
      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections/unknown", {
        method: "DELETE",
      })
      expect(res.status).toBe(404)
    })

    it("returns 403 for workspace integration", async () => {
      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections/shopify", {
        method: "DELETE",
      })
      expect(res.status).toBe(403)
    })

    it("returns 401 when not authenticated", async () => {
      mockGetSession.mockReturnValue(undefined)
      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections/notion", {
        method: "DELETE",
      })
      expect(res.status).toBe(401)
    })
  })
})
