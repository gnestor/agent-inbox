import { vi, describe, it, expect, beforeEach } from "vitest"

// Mock DB and credentials (required by session-manager module)
const mockExecute = vi.fn<(...args: any[]) => Promise<any>>(async () => ({ rowCount: 0 }))
const mockQueryOne = vi.fn<(...args: any[]) => Promise<any>>(async () => undefined)
const mockQuery = vi.fn<(...args: any[]) => Promise<any[]>>(async () => [])

vi.mock("../../db/pool.js", () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
  withTransaction: vi.fn(async (fn: any) => fn({
    query: vi.fn(async () => ({ rows: [] })),
  })),
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
    mockExecute.mockClear()
    mockQueryOne.mockClear()
    mockQuery.mockResolvedValue([])
  })

  it("addPresenceUser adds user to presence map", async () => {
    const { addPresenceUser, getPresenceUsers } = await import("../session-manager.js")
    addPresenceUser("sess-1", { email: "alice@test.com", name: "Alice", picture: "https://example.com/alice.jpg" })
    const users = getPresenceUsers("sess-1")
    expect(users).toHaveLength(1)
    expect(users[0]!).toMatchObject({ email: "alice@test.com", name: "Alice" })
  })

  it("Scenario: Presence broadcasts debounce at 200 ms — addPresenceUser broadcasts presence event to WS clients (debounced)", async () => {
    const { addWsClient, wsSubscribe, addPresenceUser } = await import("../session-manager.js")
    const received: any[] = []
    addWsClient("c-2", (data) => received.push(data))
    await wsSubscribe("c-2", [{ id: "sess-2" }])
    addPresenceUser("sess-2", { email: "alice@test.com", name: "Alice" })
    // Debounced: wait for the broadcast timer to fire.
    await new Promise((r) => setTimeout(r, 250))
    const presenceEvents = received.filter((m) => m.data?.type === "presence" && m.sessionId === "sess-2")
    expect(presenceEvents).toHaveLength(1)
    expect(presenceEvents[0]!.data.users).toHaveLength(1)
    expect(presenceEvents[0]!.data.users[0]!.email).toBe("alice@test.com")
  })

  it("removePresenceUser removes user from presence map and broadcasts", async () => {
    const { addWsClient, wsSubscribe, addPresenceUser, removePresenceUser, getPresenceUsers } = await import("../session-manager.js")
    const received: any[] = []
    addWsClient("c-3", (data) => received.push(data))
    await wsSubscribe("c-3", [{ id: "sess-3" }])
    addPresenceUser("sess-3", { email: "alice@test.com", name: "Alice" })
    addPresenceUser("sess-3", { email: "bob@test.com", name: "Bob" })
    removePresenceUser("sess-3", "alice@test.com")
    // Debounced: the three rapid calls coalesce into a single broadcast.
    await new Promise((r) => setTimeout(r, 250))
    const users = getPresenceUsers("sess-3")
    expect(users).toHaveLength(1)
    expect(users[0]!.email).toBe("bob@test.com")
    const presenceEvents = received.filter((m) => m.data?.type === "presence" && m.sessionId === "sess-3")
    expect(presenceEvents).toHaveLength(1)
    expect(presenceEvents[0]!.data.users).toHaveLength(1)
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
    mockExecute.mockClear()
    mockQueryOne.mockClear()
    mockQuery.mockResolvedValue([])
  })

  it("Scenario: `resumeSessionQuery(sessionId, prompt)` continues an existing session — broadcasts user message with authorEmail/authorName when userProfile provided", async () => {
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: vi.fn(() => ({
        [Symbol.asyncIterator]: async function* () {},
      })),
      tool: vi.fn(),
      createSdkMcpServer: vi.fn(),
    }))

    const { resumeSessionQuery, addWsClient, wsSubscribe } = await import("../session-manager.js")

    // Register a WS client and subscribe to capture broadcasts
    const broadcasts: any[] = []
    addWsClient("c-auth-1", (data) => broadcasts.push(data))
    await wsSubscribe("c-auth-1", [{ id: "sess-auth-1" }])

    await resumeSessionQuery("sess-auth-1", "Hello world", undefined, {
      email: "alice@test.com",
      name: "Alice",
      picture: "https://example.com/alice.jpg",
    })

    const userBroadcast = broadcasts.find((b) => b.data?.message?.type === "user")
    expect(userBroadcast).toBeDefined()
    expect(userBroadcast.data.message.authorEmail).toBe("alice@test.com")
    expect(userBroadcast.data.message.authorName).toBe("Alice")
  })

  it("omits author fields when no userProfile provided (backward compat)", async () => {
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: vi.fn(() => ({
        [Symbol.asyncIterator]: async function* () {},
      })),
      tool: vi.fn(),
      createSdkMcpServer: vi.fn(),
    }))

    const { resumeSessionQuery, addWsClient, wsSubscribe } = await import("../session-manager.js")

    const broadcasts: any[] = []
    addWsClient("c-auth-2", (data) => broadcasts.push(data))
    await wsSubscribe("c-auth-2", [{ id: "sess-auth-2" }])

    await resumeSessionQuery("sess-auth-2", "Hello world", undefined, undefined)

    const userBroadcast = broadcasts.find((b) => b.data?.message?.type === "user")
    expect(userBroadcast).toBeDefined()
    expect(userBroadcast.data.message.authorEmail).toBeUndefined()
    expect(userBroadcast.data.message.authorName).toBeUndefined()
  })
})

describe("resumeSessionQuery stale-entry recovery", () => {
  beforeEach(async () => {
    vi.resetModules()
    mockExecute.mockReset()
    mockQueryOne.mockReset()
    mockQuery.mockResolvedValue([])
    // Make updateSessionStatus's UPDATE succeed so it doesn't fall through to a
    // diagnostic queryOne and shift our queryOne mock sequence.
    mockExecute.mockResolvedValue({ rowCount: 1 })
  })

  it("clears stale runningQueries entry when DB shows session not running", async () => {
    // First resume: agentQuery throws synchronously, so the IIFE never runs
    // and the runningQueries entry would leak without the catch block.
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: vi.fn(() => { throw new Error("agent setup boom") }),
      tool: vi.fn(),
      createSdkMcpServer: vi.fn(),
    }))

    // First call: only sessionRecord queryOne fires (returns undefined).
    // Second call: stale-entry check sees "errored" → reconcile and proceed.
    //              Then sessionRecord lookup returns undefined again.
    mockQueryOne
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ status: "errored" })
      .mockResolvedValue(undefined)

    const { resumeSessionQuery } = await import("../session-manager.js")

    await expect(
      resumeSessionQuery("sess-stale-1", "first try", undefined, undefined),
    ).rejects.toThrow("agent setup boom")

    // Swap the SDK mock to a non-throwing one for the retry.
    vi.doUnmock("@anthropic-ai/claude-agent-sdk")
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: vi.fn(() => ({ [Symbol.asyncIterator]: async function* () {} })),
      tool: vi.fn(),
      createSdkMcpServer: vi.fn(),
    }))

    const result = await resumeSessionQuery("sess-stale-1", "retry", undefined, undefined)
    expect(result.started).toBe(true)
  })

  it("Scenario: A prompt submitted while the iterator is already running is queued — queues a second prompt while a session is actively running", async () => {
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: vi.fn(() => ({
        [Symbol.asyncIterator]: async function* () {
          await new Promise(() => {}) // hang forever to keep entry alive
        },
      })),
      tool: vi.fn(),
      createSdkMcpServer: vi.fn(),
    }))

    // First call: sessionRecord lookup → undefined.
    // Second call: stale-entry check sees status "running" → queue and return started=false.
    mockQueryOne
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ status: "running" })

    const { resumeSessionQuery } = await import("../session-manager.js")

    const first = await resumeSessionQuery("sess-active-1", "first", undefined, undefined)
    expect(first.started).toBe(true)

    const second = await resumeSessionQuery("sess-active-1", "second", undefined, undefined)
    expect(second.started).toBe(false)
    expect(second.queued).toBe(true)
  })

  it("Scenario: `abortRunningSession` triggers the registered `AbortController` — drains a queued prompt after the running iterator completes", async () => {
    // First query hangs once started, but we can release it by aborting.
    // Second query (the queued one) should be set up after the first cleans up.
    const queryCalls: string[] = []
    const firstHandle: { resolve: (() => void) | null } = { resolve: null }
    const queryMock = vi.fn(() => {
      const callIndex = queryCalls.length
      queryCalls.push(`call-${callIndex}`)
      return {
        [Symbol.asyncIterator]: async function* () {
          if (callIndex === 0) {
            await new Promise<void>((r) => { firstHandle.resolve = r })
          }
        },
      }
    })
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: queryMock,
      tool: vi.fn(),
      createSdkMcpServer: vi.fn(),
    }))

    // queryOne sequence: first call's sessionRecord lookup, second call's
    // active-running check, drained call's sessionRecord lookup.
    mockQueryOne
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ status: "running" })
      .mockResolvedValue(undefined)

    const { resumeSessionQuery, abortRunningSession } = await import("../session-manager.js")

    const first = await resumeSessionQuery("sess-drain-1", "first", undefined, undefined)
    expect(first.started).toBe(true)

    const second = await resumeSessionQuery("sess-drain-1", "queued", undefined, undefined)
    expect(second.queued).toBe(true)
    expect(queryCalls.length).toBe(1) // queued, not started

    // Releasing the first iterator lets cleanup run and drain the queue.
    await abortRunningSession("sess-drain-1")
    firstHandle.resolve?.()

    // Wait for microtask + setup to complete.
    await new Promise((r) => setTimeout(r, 20))

    expect(queryCalls.length).toBe(2)
  })
})
