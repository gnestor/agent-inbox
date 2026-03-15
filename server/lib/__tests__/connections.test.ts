import { describe, it, expect, vi, beforeEach } from "vitest"
import Database from "better-sqlite3"
import { Hono } from "hono"

process.env.VAULT_SECRET = "aa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"

const dbHolder: { db: Database.Database | null } = { db: null }

vi.mock("../../db/schema.js", () => ({
  getDb: () => dbHolder.db!,
}))

// Mock session-manager to provide a workspace path
vi.mock("../session-manager.js", () => ({
  getWorkspacePath: () => "/test/workspace",
}))

// Mock auth — provide a controllable session lookup
const mockGetSession = vi.fn()
vi.mock("../auth.js", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

const { connectionRoutes } = await import("../../routes/connections.js")
const { storeUserCredential, storeWorkspaceCredential } = await import("../vault.js")

function createSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      picture TEXT,
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_name TEXT NOT NULL,
      user_email TEXT NOT NULL,
      user_picture TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_credentials (
      user_email TEXT NOT NULL REFERENCES users(email),
      integration TEXT NOT NULL,
      encrypted_token TEXT NOT NULL,
      refresh_token TEXT,
      scopes TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_email, integration)
    );
    CREATE TABLE IF NOT EXISTS workspace_credentials (
      workspace TEXT NOT NULL,
      integration TEXT NOT NULL,
      encrypted_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace, integration)
    );
  `)
}

function createTestApp() {
  const app = new Hono()
  app.route("/api/connections", connectionRoutes)
  return app
}

function makeRequest(app: Hono, path: string, options: RequestInit = {}) {
  return app.request(path, {
    headers: {
      Cookie: "inbox_session=test-token",
      ...options.headers,
    },
    ...options,
  })
}

describe("connection routes", () => {
  const testEmail = "test@hammies.com"

  beforeEach(() => {
    dbHolder.db = new Database(":memory:")
    createSchema(dbHolder.db)
    // Create test user
    dbHolder.db.prepare(
      "INSERT INTO users (email, name, created_at, last_login_at) VALUES (?, ?, ?, ?)"
    ).run(testEmail, "Test User", new Date().toISOString(), new Date().toISOString())
    // Mock session lookup
    mockGetSession.mockReset()
    mockGetSession.mockReturnValue({
      user: { name: "Test User", email: testEmail, picture: undefined },
    })
  })

  describe("GET /api/connections", () => {
    it("returns all integrations with connection status", async () => {
      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections")
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.integrations).toBeDefined()
      expect(Array.isArray(data.integrations)).toBe(true)
      expect(data.integrations.length).toBeGreaterThanOrEqual(6)

      // All should be disconnected initially
      for (const integration of data.integrations) {
        expect(integration.connected).toBe(false)
        expect(integration.id).toBeTruthy()
        expect(integration.name).toBeTruthy()
      }
    })

    it("shows user integrations as connected when credentials exist", async () => {
      storeUserCredential(testEmail, "notion", { token: "test-token" })

      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections")
      const data = await res.json()

      const notion = data.integrations.find((i: any) => i.id === "notion")
      expect(notion.connected).toBe(true)

      const slack = data.integrations.find((i: any) => i.id === "slack")
      expect(slack.connected).toBe(false)
    })

    it("shows workspace integrations as connected when credentials exist", async () => {
      storeWorkspaceCredential("/test/workspace", "shopify", "shop-token")

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
      // Ensure env var is not set
      delete process.env.NOTION_OAUTH_CLIENT_ID
      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections/connect/notion")
      expect(res.status).toBe(500)
    })

    it("redirects to OAuth provider when configured", async () => {
      process.env.GITHUB_CLIENT_ID = "test-github-client-id"
      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections/connect/github", {
        redirect: "manual",
      })
      expect(res.status).toBe(302)
      const location = res.headers.get("Location")
      expect(location).toContain("https://github.com/login/oauth/authorize")
      expect(location).toContain("client_id=test-github-client-id")
      expect(location).toContain("state=")
      expect(location).toContain("scope=repo+read%3Aorg")
      // Clean up
      delete process.env.GITHUB_CLIENT_ID
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
    it("disconnects a user integration", async () => {
      storeUserCredential(testEmail, "notion", { token: "test-token" })

      const app = createTestApp()
      const res = await makeRequest(app, "http://localhost/api/connections/notion", {
        method: "DELETE",
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)

      // Verify it's disconnected
      const listRes = await makeRequest(app, "http://localhost/api/connections")
      const listData = await listRes.json()
      const notion = listData.integrations.find((i: any) => i.id === "notion")
      expect(notion.connected).toBe(false)
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
