import { describe, it, expect, vi, beforeEach } from "vitest"
import Database from "better-sqlite3"

const dbHolder: { db: Database.Database | null } = { db: null }

vi.mock("../../db/schema.js", () => ({
  getDb: () => dbHolder.db!,
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

function okJson(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) })
}

const { getClientId, verifyIdToken, getSession, deleteSession } = await import("../auth.js")

describe("auth", () => {
  beforeEach(() => {
    dbHolder.db = new Database(":memory:")
    dbHolder.db.exec(`
      CREATE TABLE users (
        email TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        picture TEXT,
        created_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL
      );
      CREATE TABLE auth_sessions (
        token TEXT PRIMARY KEY,
        user_name TEXT NOT NULL,
        user_email TEXT NOT NULL,
        user_picture TEXT,
        created_at TEXT NOT NULL
      );
    `)
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

      // Verify user was created in DB
      const user = dbHolder.db!.prepare("SELECT * FROM users WHERE email = ?").get("alice@test.com") as any
      expect(user.name).toBe("Alice")

      // Verify session was created
      const session = dbHolder.db!.prepare("SELECT * FROM auth_sessions WHERE token = ?").get(result.sessionToken) as any
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

      const users = dbHolder.db!.prepare("SELECT * FROM users").all() as any[]
      expect(users).toHaveLength(1)
      expect(users[0].name).toBe("Alice Updated")
    })
  })

  describe("getSession", () => {
    it("returns user data for valid session token", async () => {
      process.env.GOOGLE_CLIENT_ID = "test-client-id"
      mockFetch.mockReturnValueOnce(
        okJson({ aud: "test-client-id", email: "bob@test.com", name: "Bob" }),
      )

      const { sessionToken } = await verifyIdToken("cred")
      const session = getSession(sessionToken)

      expect(session).toBeDefined()
      expect(session!.user.name).toBe("Bob")
      expect(session!.user.email).toBe("bob@test.com")
    })

    it("returns undefined for invalid token", () => {
      expect(getSession("nonexistent-token")).toBeUndefined()
    })
  })

  describe("deleteSession", () => {
    it("removes session from DB", async () => {
      process.env.GOOGLE_CLIENT_ID = "test-client-id"
      mockFetch.mockReturnValueOnce(
        okJson({ aud: "test-client-id", email: "bob@test.com", name: "Bob" }),
      )

      const { sessionToken } = await verifyIdToken("cred")
      expect(getSession(sessionToken)).toBeDefined()

      deleteSession(sessionToken)
      expect(getSession(sessionToken)).toBeUndefined()
    })
  })
})
