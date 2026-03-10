import { vi, describe, it, expect, beforeEach } from "vitest"
import { Hono } from "hono"

// ── In-memory DB ─────────────────────────────────────────────────────────────

const dbHolder: { db: ReturnType<import("better-sqlite3").default> | null } = { db: null }

vi.mock("../../db/schema.js", async () => {
  const Database = (await import("better-sqlite3")).default
  const db = new Database(":memory:")
  db.prepare(
    `CREATE TABLE IF NOT EXISTS user_preferences (
      user_email TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_email, key)
    )`,
  ).run()
  dbHolder.db = db
  return { getDb: () => dbHolder.db }
})

// ── Auth mock ─────────────────────────────────────────────────────────────────

vi.mock("../../lib/auth.js", () => ({ getSession: vi.fn() }))
vi.mock("../../routes/auth.js", () => ({ SESSION_COOKIE: "inbox_session" }))

const { getSession } = await import("../../lib/auth.js")
const { preferencesRoutes } = await import("../../routes/preferences.js")

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_TOKEN = "test-token"

function setupUser(email: string | null) {
  vi.mocked(getSession).mockReturnValue(
    email ? { user: { name: "Test", email, picture: undefined } } : undefined,
  )
}

const app = new Hono()
app.route("/preferences", preferencesRoutes)

function req(path: string, options: RequestInit = {}, email: string | null = "alice@example.com") {
  setupUser(email)
  const headers = new Headers(options.headers as HeadersInit)
  if (email) headers.set("Cookie", `inbox_session=${TEST_TOKEN}`)
  return app.request(path, { ...options, headers })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("preferences routes", () => {
  beforeEach(() => {
    dbHolder.db!.prepare("DELETE FROM user_preferences").run()
    vi.clearAllMocks()
  })

  describe("GET /preferences", () => {
    it("returns 401 when not authenticated", async () => {
      const res = await req("/preferences", {}, null)
      expect(res.status).toBe(401)
    })

    it("returns empty object when no preferences exist", async () => {
      const res = await req("/preferences")
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({})
    })

    it("returns preferences for the authenticated user only", async () => {
      dbHolder.db!
        .prepare(`INSERT INTO user_preferences (user_email, key, value, updated_at) VALUES (?, ?, ?, ?)`)
        .run("alice@example.com", "theme", JSON.stringify("dark"), new Date().toISOString())
      dbHolder.db!
        .prepare(`INSERT INTO user_preferences (user_email, key, value, updated_at) VALUES (?, ?, ?, ?)`)
        .run("bob@example.com", "theme", JSON.stringify("light"), new Date().toISOString())

      const res = await req("/preferences", {}, "alice@example.com")
      expect(await res.json()).toEqual({ theme: "dark" })
    })

    it("deserializes JSON values", async () => {
      dbHolder.db!
        .prepare(`INSERT INTO user_preferences (user_email, key, value, updated_at) VALUES (?, ?, ?, ?)`)
        .run(
          "alice@example.com",
          "visibility",
          JSON.stringify({ messages: true, toolCalls: false, thinking: true }),
          new Date().toISOString(),
        )

      const res = await req("/preferences")
      expect(await res.json()).toEqual({
        visibility: { messages: true, toolCalls: false, thinking: true },
      })
    })
  })

  describe("PUT /preferences", () => {
    it("returns 401 when not authenticated", async () => {
      const res = await req(
        "/preferences",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "theme", value: "dark" }),
        },
        null,
      )
      expect(res.status).toBe(401)
    })

    it("stores a preference and reads it back", async () => {
      await req("/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "theme", value: "dark" }),
      })
      const res = await req("/preferences")
      expect(await res.json()).toEqual({ theme: "dark" })
    })

    it("overwrites an existing preference", async () => {
      await req("/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "theme", value: "dark" }),
      })
      await req("/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "theme", value: "light" }),
      })
      const res = await req("/preferences")
      expect(await res.json()).toEqual({ theme: "light" })
    })

    it("scopes writes to each user", async () => {
      await req("/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "theme", value: "dark" }),
      }, "alice@example.com")
      await req("/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "theme", value: "light" }),
      }, "bob@example.com")

      expect(await (await req("/preferences", {}, "alice@example.com")).json()).toEqual({ theme: "dark" })
      expect(await (await req("/preferences", {}, "bob@example.com")).json()).toEqual({ theme: "light" })
    })

    it("returns 400 when key is missing", async () => {
      const res = await req("/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "dark" }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe("PUT /preferences/batch", () => {
    it("stores multiple preferences atomically", async () => {
      await req("/preferences/batch", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: { theme: "dark", language: "en", count: 42 } }),
      })
      const res = await req("/preferences")
      expect(await res.json()).toEqual({ theme: "dark", language: "en", count: 42 })
    })

    it("returns 401 when not authenticated", async () => {
      const res = await req(
        "/preferences/batch",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        null,
      )
      expect(res.status).toBe(401)
    })

    it("returns 400 when prefs is missing", async () => {
      const res = await req("/preferences/batch", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })
  })
})
