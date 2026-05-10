import { vi, describe, it, expect, beforeEach } from "vitest"
import { Hono } from "hono"

// ── In-memory DB ─────────────────────────────────────────────────────────────

const prefsStore = new Map<string, { user_email: string; key: string; value: string; updated_at: string }>()

vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM user_preferences") && sql.includes("WHERE user_email")) {
      const email = params![0] as string
      const results: any[] = []
      for (const entry of prefsStore.values()) {
        if (entry.user_email === email) {
          results.push(entry)
        }
      }
      return results
    }
    return []
  }),
  queryOne: vi.fn(async () => undefined),
  execute: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("INSERT INTO user_preferences") || sql.includes("user_preferences")) {
      if (sql.includes("INSERT")) {
        const user_email = params![0] as string
        const key = params![1] as string
        const value = params![2] as string
        const updated_at = params![3] as string
        prefsStore.set(`${user_email}:${key}`, { user_email, key, value, updated_at })
        return { rowCount: 1 }
      }
    }
    return { rowCount: 0 }
  }),
  withTransaction: vi.fn(async (fn: any) => {
    // For batch operations, provide a client that writes to our store
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] }
        if (sql.includes("INSERT INTO user_preferences")) {
          const user_email = params![0] as string
          const key = params![1] as string
          const value = params![2] as string
          const updated_at = params![3] as string
          prefsStore.set(`${user_email}:${key}`, { user_email, key, value, updated_at })
        }
        return { rows: [] }
      }),
    }
    return fn(client)
  }),
}))

// ── Auth mock ─────────────────────────────────────────────────────────────────

vi.mock("../../lib/auth.js", () => ({ getSession: vi.fn() }))
vi.mock("../../routes/auth.js", () => ({ SESSION_COOKIE: "hammies_session" }))

const { getSession } = await import("../../lib/auth.js")
const { preferencesRoutes } = await import("../../routes/preferences.js")

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_TOKEN = "test-token"

function setupUser(email: string | null) {
  vi.mocked(getSession).mockResolvedValue(
    email ? { user: { name: "Test", email, picture: undefined } } : undefined,
  )
}

const app = new Hono()
app.route("/preferences", preferencesRoutes)

function req(path: string, options: RequestInit = {}, email: string | null = "alice@example.com") {
  setupUser(email)
  const headers = new Headers(options.headers as HeadersInit)
  if (email) headers.set("Cookie", `hammies_session=${TEST_TOKEN}`)
  return app.request(path, { ...options, headers })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("preferences routes", () => {
  beforeEach(() => {
    prefsStore.clear()
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
      prefsStore.set("alice@example.com:theme", {
        user_email: "alice@example.com",
        key: "theme",
        value: JSON.stringify("dark"),
        updated_at: new Date().toISOString(),
      })
      prefsStore.set("bob@example.com:theme", {
        user_email: "bob@example.com",
        key: "theme",
        value: JSON.stringify("light"),
        updated_at: new Date().toISOString(),
      })

      const res = await req("/preferences", {}, "alice@example.com")
      expect(await res.json()).toEqual({ theme: "dark" })
    })

    it("deserializes JSON values", async () => {
      prefsStore.set("alice@example.com:visibility", {
        user_email: "alice@example.com",
        key: "visibility",
        value: JSON.stringify({ messages: true, toolCalls: false, thinking: true }),
        updated_at: new Date().toISOString(),
      })

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
