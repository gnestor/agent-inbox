import { describe, it, expect, vi, beforeEach } from "vitest"

const users = new Map<string, { email: string; name: string; picture: string | null }>()

vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => undefined),
  execute: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("INSERT INTO users")) {
      const email = params![0] as string
      users.set(email, {
        email,
        name: params![1] as string,
        picture: (params![2] as string | null) ?? null,
      })
    }
    return { rowCount: 1 }
  }),
}))

const mockVerifyGoogleIdToken = vi.fn()
const mockSignSession = vi.fn(async (_p: unknown) => "signed.jwt.token")
const mockVerifySession = vi.fn()
vi.mock("@hammies/auth/server", () => ({
  SESSION_COOKIE: "hammies_session",
  verifyGoogleIdToken: (cred: string) => mockVerifyGoogleIdToken(cred),
  signSession: (p: unknown) => mockSignSession(p),
  verifySession: (t: string) => mockVerifySession(t),
}))

const { getClientId, verifyIdToken, getSession, deleteSession, SESSION_COOKIE } = await import(
  "../auth.js"
)

describe("auth", () => {
  beforeEach(() => {
    users.clear()
    mockVerifyGoogleIdToken.mockReset()
    mockSignSession.mockReset().mockResolvedValue("signed.jwt.token")
    mockVerifySession.mockReset()
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

  describe("SESSION_COOKIE", () => {
    it("re-exports the shared hammies cookie name", () => {
      expect(SESSION_COOKIE).toBe("hammies_session")
    })
  })

  describe("verifyIdToken", () => {
    it("verifies token, upserts user, mints JWT session token", async () => {
      mockVerifyGoogleIdToken.mockResolvedValueOnce({
        sub: "google-sub-1",
        email: "alice@test.com",
        name: "Alice",
        picture: "https://pic.test/alice.jpg",
      })

      const result = await verifyIdToken("valid-credential")

      expect(mockVerifyGoogleIdToken).toHaveBeenCalledWith("valid-credential")
      expect(result.sessionToken).toBe("signed.jwt.token")
      expect(result.user).toEqual({
        name: "Alice",
        email: "alice@test.com",
        picture: "https://pic.test/alice.jpg",
      })
      expect(users.get("alice@test.com")?.name).toBe("Alice")
      expect(mockSignSession).toHaveBeenCalledWith({
        sub: "google-sub-1",
        email: "alice@test.com",
        name: "Alice",
        picture: "https://pic.test/alice.jpg",
      })
    })

    it("propagates verification failure from Google", async () => {
      mockVerifyGoogleIdToken.mockRejectedValueOnce(new Error("Google credential missing email"))
      await expect(verifyIdToken("bad")).rejects.toThrow("Google credential missing email")
    })

    it("upserts the user on re-login (ON CONFLICT DO UPDATE)", async () => {
      mockVerifyGoogleIdToken.mockResolvedValueOnce({
        sub: "s1",
        email: "alice@test.com",
        name: "Alice",
      })
      await verifyIdToken("c1")
      mockVerifyGoogleIdToken.mockResolvedValueOnce({
        sub: "s1",
        email: "alice@test.com",
        name: "Alice Updated",
      })
      await verifyIdToken("c2")
      expect(users.size).toBe(1)
      expect(users.get("alice@test.com")?.name).toBe("Alice Updated")
    })
  })

  describe("getSession", () => {
    it("returns the user when JWT verification succeeds", async () => {
      mockVerifySession.mockResolvedValueOnce({
        sub: "s1",
        email: "bob@test.com",
        name: "Bob",
        picture: undefined,
        iat: 0,
        exp: 0,
      })
      const session = await getSession("a.jwt.token")
      expect(session).toBeDefined()
      expect(session!.user.email).toBe("bob@test.com")
      expect(session!.user.name).toBe("Bob")
    })

    it("returns undefined when JWT verification throws", async () => {
      mockVerifySession.mockRejectedValueOnce(new Error("invalid"))
      expect(await getSession("garbage")).toBeUndefined()
    })
  })

  describe("deleteSession", () => {
    it("is a no-op (JWT sessions are stateless)", async () => {
      await expect(deleteSession("any")).resolves.toBeUndefined()
    })
  })
})
