import { describe, it, expect, vi, beforeEach } from "vitest"

// In-memory stores to simulate DB tables
const users = new Map<string, any>()
const sessions = new Map<string, any>()

vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("auth_sessions") && sql.includes("token")) {
      const token = params![0] as string
      return sessions.get(token)
    }
    return undefined
  }),
  execute: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("INSERT INTO users")) {
      const email = params![0] as string
      const name = params![1] as string
      const picture = params![2]
      const created_at = params![3] as string
      const last_login_at = params![4] as string
      users.set(email, { email, name, picture, created_at, last_login_at })
      return { rowCount: 1 }
    }
    if (sql.includes("INSERT INTO auth_sessions")) {
      const token = params![0] as string
      const user_name = params![1] as string
      const user_email = params![2] as string
      const user_picture = params![3]
      sessions.set(token, { user_name, user_email, user_picture })
      return { rowCount: 1 }
    }
    if (sql.includes("DELETE FROM auth_sessions")) {
      const token = params![0] as string
      sessions.delete(token)
      return { rowCount: 1 }
    }
    return { rowCount: 0 }
  }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

function okJson(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) })
}

const { getClientId, verifyIdToken, getSession, deleteSession } = await import("../auth.js")

describe("auth", () => {
  beforeEach(() => {
    users.clear()
    sessions.clear()
    mockFetch.mockReset()
  })

  describe("getClientId", () => {
    it("returns GOOGLE_CLIENT_ID from env", () => {
      process.env.GOOGLE_CLIENT_ID = "test-client-id"
      expect(getClientId()).toBe("test-client-id")
    })

    it("throws when GOOGLE_CLIENT_ID is missing", () => {
      delete process.env.GOOGLE_CLIENT_ID
      expect(() => getClientId()).toThrow("Missing GOOGLE_CLIENT_ID")
    })
  })

  describe("verifyIdToken", () => {
    beforeEach(() => {
      process.env.GOOGLE_CLIENT_ID = "test-client-id"
    })

    it("verifies token, creates user and session", async () => {
      mockFetch.mockReturnValueOnce(
        okJson({
          aud: "test-client-id",
          email: "alice@test.com",
          name: "Alice",
          picture: "https://pic.test/alice.jpg",
        }),
      )

      const result = await verifyIdToken("valid-credential")

      expect(result.sessionToken).toHaveLength(64) // 32 bytes hex
      expect(result.user).toEqual({
        name: "Alice",
        email: "alice@test.com",
        picture: "https://pic.test/alice.jpg",
      })

      // Verify user was created in store
      const user = users.get("alice@test.com")
      expect(user.name).toBe("Alice")

      // Verify session was created
      const session = sessions.get(result.sessionToken)
      expect(session.user_email).toBe("alice@test.com")
    })

    it("throws on audience mismatch", async () => {
      mockFetch.mockReturnValueOnce(
        okJson({ aud: "wrong-client-id", email: "alice@test.com", name: "Alice" }),
      )

      await expect(verifyIdToken("bad-token")).rejects.toThrow("ID token audience mismatch")
    })

    it("throws when Google API rejects token", async () => {
      mockFetch.mockReturnValueOnce(
        Promise.resolve({ ok: false, text: () => Promise.resolve("Invalid token") }),
      )

      await expect(verifyIdToken("invalid")).rejects.toThrow("ID token verification failed")
    })

    it("updates existing user on re-login", async () => {
      // First login
      mockFetch.mockReturnValueOnce(
        okJson({ aud: "test-client-id", email: "alice@test.com", name: "Alice" }),
      )
      await verifyIdToken("cred1")

      // Second login with updated name
      mockFetch.mockReturnValueOnce(
        okJson({ aud: "test-client-id", email: "alice@test.com", name: "Alice Updated" }),
      )
      await verifyIdToken("cred2")

      // ON CONFLICT DO UPDATE overwrites the name
      expect(users.size).toBe(1)
      expect(users.get("alice@test.com").name).toBe("Alice Updated")
    })
  })

  describe("getSession", () => {
    it("returns user data for valid session token", async () => {
      process.env.GOOGLE_CLIENT_ID = "test-client-id"
      mockFetch.mockReturnValueOnce(
        okJson({ aud: "test-client-id", email: "bob@test.com", name: "Bob" }),
      )

      const { sessionToken } = await verifyIdToken("cred")
      const session = await getSession(sessionToken)

      expect(session).toBeDefined()
      expect(session!.user.name).toBe("Bob")
      expect(session!.user.email).toBe("bob@test.com")
    })

    it("returns undefined for invalid token", async () => {
      expect(await getSession("nonexistent-token")).toBeUndefined()
    })
  })

  describe("deleteSession", () => {
    it("removes session from DB", async () => {
      process.env.GOOGLE_CLIENT_ID = "test-client-id"
      mockFetch.mockReturnValueOnce(
        okJson({ aud: "test-client-id", email: "bob@test.com", name: "Bob" }),
      )

      const { sessionToken } = await verifyIdToken("cred")
      expect(await getSession(sessionToken)).toBeDefined()

      await deleteSession(sessionToken)
      expect(await getSession(sessionToken)).toBeUndefined()
    })
  })
})
