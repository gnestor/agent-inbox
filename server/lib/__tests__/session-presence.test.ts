import { vi, describe, it, expect, beforeEach } from "vitest"

// Mock DB and credentials (required by session-manager module)
const mockRun = vi.fn()
const mockGet = vi.fn()
const mockAll = vi.fn(() => [])

vi.mock("../../db/schema.js", () => ({
  getDb: () => ({
    prepare: () => ({ run: mockRun, get: mockGet, all: mockAll }),
  }),
}))

vi.mock("../../lib/credentials.js", () => ({
  getAgentEnv: () => ({}),
}))

vi.mock("../../lib/title-generator.js", () => ({
  generateSessionTitle: vi.fn().mockResolvedValue(null),
}))

describe("session presence tracking", () => {
  beforeEach(async () => {
    vi.resetModules()
    mockRun.mockClear()
    mockGet.mockClear()
    mockAll.mockReturnValue([])
  })

  it("addPresenceUser adds user to presence map", async () => {
    const { addPresenceUser, getPresenceUsers } = await import("../session-manager.js")
    addPresenceUser("sess-1", { email: "alice@test.com", name: "Alice", picture: "https://example.com/alice.jpg" })
    const users = getPresenceUsers("sess-1")
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({ email: "alice@test.com", name: "Alice" })
  })

  it("addPresenceUser broadcasts presence event to SSE clients", async () => {
    const { addSseClient, addPresenceUser } = await import("../session-manager.js")
    const received: string[] = []
    addSseClient("sess-2", (data) => received.push(data))
    addPresenceUser("sess-2", { email: "alice@test.com", name: "Alice" })
    expect(received).toHaveLength(1)
    const event = JSON.parse(received[0])
    expect(event.type).toBe("presence")
    expect(event.users).toHaveLength(1)
    expect(event.users[0].email).toBe("alice@test.com")
  })

  it("removePresenceUser removes user from presence map and broadcasts", async () => {
    const { addSseClient, addPresenceUser, removePresenceUser, getPresenceUsers } = await import("../session-manager.js")
    const received: string[] = []
    addSseClient("sess-3", (data) => received.push(data))
    addPresenceUser("sess-3", { email: "alice@test.com", name: "Alice" })
    addPresenceUser("sess-3", { email: "bob@test.com", name: "Bob" })
    removePresenceUser("sess-3", "alice@test.com")
    const users = getPresenceUsers("sess-3")
    expect(users).toHaveLength(1)
    expect(users[0].email).toBe("bob@test.com")
    // Should have received 3 broadcasts: add alice, add bob, remove alice
    expect(received).toHaveLength(3)
    const lastEvent = JSON.parse(received[2])
    expect(lastEvent.type).toBe("presence")
    expect(lastEvent.users).toHaveLength(1)
  })

  it("removePresenceUser cleans up empty session maps (no memory leak)", async () => {
    const { addPresenceUser, removePresenceUser, getPresenceUsers } = await import("../session-manager.js")
    addPresenceUser("sess-4", { email: "alice@test.com", name: "Alice" })
    removePresenceUser("sess-4", "alice@test.com")
    const users = getPresenceUsers("sess-4")
    expect(users).toHaveLength(0)
  })

  it("getPresenceUsers returns empty array for unknown session", async () => {
    const { getPresenceUsers } = await import("../session-manager.js")
    const users = getPresenceUsers("unknown-session")
    expect(users).toEqual([])
  })

  it("multiple users can be present in same session", async () => {
    const { addPresenceUser, getPresenceUsers } = await import("../session-manager.js")
    addPresenceUser("sess-5", { email: "alice@test.com", name: "Alice" })
    addPresenceUser("sess-5", { email: "bob@test.com", name: "Bob" })
    const users = getPresenceUsers("sess-5")
    expect(users).toHaveLength(2)
  })
})

describe("resumeSessionQuery author attribution", () => {
  beforeEach(async () => {
    vi.resetModules()
    mockRun.mockClear()
    mockGet.mockClear()
    mockAll.mockReturnValue([])
  })

  it("stores authorEmail/authorName/authorPicture on user message when userProfile provided", async () => {
    // Mock the claude-agent-sdk to avoid actual network calls
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: vi.fn(() => ({
        [Symbol.asyncIterator]: async function* () {},
      })),
      tool: vi.fn(),
      createSdkMcpServer: vi.fn(),
    }))

    // Capture all JSON values passed to db.prepare().run()
    const storedJsonArgs: unknown[] = []
    mockRun.mockImplementation((...args: unknown[]) => {
      for (const arg of args) {
        if (typeof arg === "string" && arg.startsWith("{")) {
          try {
            storedJsonArgs.push(JSON.parse(arg))
          } catch { /* ignore */ }
        }
      }
    })
    mockAll.mockReturnValue([]) // no existing messages

    const { resumeSessionQuery } = await import("../session-manager.js")

    await resumeSessionQuery("sess-auth-1", "Hello world", undefined, {
      email: "alice@test.com",
      name: "Alice",
      picture: "https://example.com/alice.jpg",
    })

    // Find the user message that was stored
    const userMsgs = storedJsonArgs.filter((m: any) => m?.type === "user")
    expect(userMsgs.length).toBeGreaterThan(0)
    const userMsg = userMsgs[0] as any
    expect(userMsg.authorEmail).toBe("alice@test.com")
    expect(userMsg.authorName).toBe("Alice")
    expect(userMsg.authorPicture).toBeUndefined() // picture stored in DB, not JSONL
  })

  it("omits author fields when no userProfile provided (backward compat)", async () => {
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: vi.fn(() => ({
        [Symbol.asyncIterator]: async function* () {},
      })),
      tool: vi.fn(),
      createSdkMcpServer: vi.fn(),
    }))

    const storedJsonArgs: unknown[] = []
    mockRun.mockImplementation((...args: unknown[]) => {
      for (const arg of args) {
        if (typeof arg === "string" && arg.startsWith("{")) {
          try {
            storedJsonArgs.push(JSON.parse(arg))
          } catch { /* ignore */ }
        }
      }
    })
    mockAll.mockReturnValue([])

    const { resumeSessionQuery } = await import("../session-manager.js")

    await resumeSessionQuery("sess-auth-2", "Hello world", undefined, undefined)

    const userMsgs = storedJsonArgs.filter((m: any) => m?.type === "user")
    expect(userMsgs.length).toBeGreaterThan(0)
    const userMsg = userMsgs[0] as any
    expect(userMsg.authorEmail).toBeUndefined()
    expect(userMsg.authorName).toBeUndefined()
    expect(userMsg.authorPicture).toBeUndefined()
  })
})
