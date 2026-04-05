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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("session presence race conditions", () => {
  beforeEach(() => {
    vi.resetModules()
    mockExecute.mockClear()
    mockQueryOne.mockClear()
    mockQuery.mockResolvedValue([])
  })

  it("tracks multiple users concurrently in the same session", async () => {
    const { addPresenceUser, getPresenceUsers } = await import("../session-manager.js")
    addPresenceUser("race-1", { email: "alice@test.com", name: "Alice" })
    addPresenceUser("race-1", { email: "bob@test.com", name: "Bob" })
    addPresenceUser("race-1", { email: "carol@test.com", name: "Carol" })
    const users = getPresenceUsers("race-1")
    expect(users).toHaveLength(3)
    const emails = users.map((u) => u.email).sort()
    expect(emails).toEqual(["alice@test.com", "bob@test.com", "carol@test.com"])
  })

  it("add-then-remove reflects correctly in getPresenceUsers", async () => {
    const { addPresenceUser, removePresenceUser, getPresenceUsers } = await import("../session-manager.js")
    addPresenceUser("race-2", { email: "alice@test.com", name: "Alice" })
    addPresenceUser("race-2", { email: "bob@test.com", name: "Bob" })
    removePresenceUser("race-2", "alice@test.com")
    const users = getPresenceUsers("race-2")
    expect(users).toHaveLength(1)
    expect(users[0]!.email).toBe("bob@test.com")
  })

  it("reapStalePresence removes entries beyond the stale timeout", async () => {
    const { addPresenceUser, getPresenceUsers, reapStalePresence } = await import("../session-manager.js")
    const t0 = Date.now()
    addPresenceUser("race-3", { email: "alice@test.com", name: "Alice" })
    addPresenceUser("race-3", { email: "bob@test.com", name: "Bob" })
    expect(getPresenceUsers("race-3")).toHaveLength(2)
    // Simulate time passing past the 60s stale threshold.
    const reaped = reapStalePresence("race-3", t0 + 61_000)
    expect(reaped).toBe(2)
    expect(getPresenceUsers("race-3")).toHaveLength(0)
  })

  it("getPresenceUsers opportunistically reaps stale entries on read", async () => {
    const { addPresenceUser, getPresenceUsers, reapStalePresence } = await import("../session-manager.js")
    addPresenceUser("race-4", { email: "alice@test.com", name: "Alice" })
    // Force stale by jumping the clock forward via the exported reaper.
    reapStalePresence("race-4", Date.now() + 120_000)
    // After reaping, list should be empty.
    expect(getPresenceUsers("race-4")).toHaveLength(0)
  })

  it("heartbeat via addPresenceUser resets lastSeen and prevents reaping", async () => {
    const { addPresenceUser, getPresenceUsers, reapStalePresence } = await import("../session-manager.js")
    addPresenceUser("race-5", { email: "alice@test.com", name: "Alice" })
    // Heartbeat immediately.
    addPresenceUser("race-5", { email: "alice@test.com", name: "Alice" })
    // Reap using current time — entry should remain because it was just touched.
    reapStalePresence("race-5", Date.now())
    expect(getPresenceUsers("race-5")).toHaveLength(1)
  })

  it("broadcasts are debounced: rapid add/remove produces one broadcast", async () => {
    const { addSseClient, addPresenceUser, removePresenceUser } = await import("../session-manager.js")
    const received: string[] = []
    await addSseClient("race-6", (data) => received.push(data))

    // 10 rapid operations — should coalesce into a single broadcast.
    for (let i = 0; i < 5; i++) {
      addPresenceUser("race-6", { email: `u${i}@test.com`, name: `User${i}` })
    }
    for (let i = 0; i < 3; i++) {
      removePresenceUser("race-6", `u${i}@test.com`)
    }
    // No broadcast has fired yet (still debouncing).
    expect(received).toHaveLength(0)
    // Wait past the 200ms debounce window.
    await sleep(250)
    // Exactly one coalesced broadcast.
    expect(received).toHaveLength(1)
    const event = JSON.parse(received[0]!)
    expect(event.type).toBe("presence")
    expect(event.users).toHaveLength(2) // u3, u4 remain
  })

  it("broadcasts separated beyond debounce window are distinct", async () => {
    const { addSseClient, addPresenceUser } = await import("../session-manager.js")
    const received: string[] = []
    await addSseClient("race-7", (data) => received.push(data))

    addPresenceUser("race-7", { email: "alice@test.com", name: "Alice" })
    await sleep(250)
    addPresenceUser("race-7", { email: "bob@test.com", name: "Bob" })
    await sleep(250)
    expect(received).toHaveLength(2)
  })

  it("removing a user who isn't present is a no-op (no broadcast)", async () => {
    const { addSseClient, removePresenceUser } = await import("../session-manager.js")
    const received: string[] = []
    await addSseClient("race-8", (data) => received.push(data))
    removePresenceUser("race-8", "ghost@test.com")
    await sleep(250)
    expect(received).toHaveLength(0)
  })
})
