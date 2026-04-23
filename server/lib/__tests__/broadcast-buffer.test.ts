import { vi, describe, it, expect, beforeEach } from "vitest"

// Mock DB and credentials (required by session-manager module)
vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({ rowCount: 0 })),
  withTransaction: vi.fn(async (fn: any) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}))
vi.mock("../../lib/credentials.js", () => ({ getAgentEnv: () => ({}) }))
vi.mock("../../lib/title-generator.js", () => ({ generateSessionTitle: vi.fn().mockResolvedValue(null) }))

describe("broadcast buffer", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("buffers sequenced broadcasts and replays them via readBroadcastBufferSince", async () => {
    const mod = await import("../session-manager.js")
    const { broadcastToSession, readBroadcastBufferSince, clearBroadcastBuffer } = mod

    clearBroadcastBuffer("buf-1")
    for (let i = 1; i <= 5; i++) {
      broadcastToSession("buf-1", { sequence: i, message: { type: "assistant", content: [] } })
    }

    const replay = readBroadcastBufferSince("buf-1", 2)
    expect(replay).not.toBeNull()
    expect(replay!.map((e) => e.sequence)).toEqual([3, 4, 5])
  })

  it("returns empty array when cursor covers all buffered entries", async () => {
    const { broadcastToSession, readBroadcastBufferSince, clearBroadcastBuffer } = await import("../session-manager.js")

    clearBroadcastBuffer("buf-2")
    broadcastToSession("buf-2", { sequence: 1, message: {} })
    broadcastToSession("buf-2", { sequence: 2, message: {} })

    const replay = readBroadcastBufferSince("buf-2", 2)
    expect(replay).toEqual([])
  })

  it("returns null (cursor miss) when caller's cursor is older than the buffer window", async () => {
    const { broadcastToSession, readBroadcastBufferSince, clearBroadcastBuffer, BROADCAST_BUFFER_CAPACITY } =
      await import("../session-manager.js")

    clearBroadcastBuffer("buf-3")
    // Fill past capacity so entries roll out the front.
    for (let i = 1; i <= BROADCAST_BUFFER_CAPACITY + 50; i++) {
      broadcastToSession("buf-3", { sequence: i, message: {} })
    }

    // Cursor at sequence 5 can't be replayed because seq 5..50 were evicted.
    const replay = readBroadcastBufferSince("buf-3", 5)
    expect(replay).toBeNull()
  })

  it("returns empty array for a cursor of 0 when no buffer exists (brand new client)", async () => {
    const { readBroadcastBufferSince, clearBroadcastBuffer } = await import("../session-manager.js")
    clearBroadcastBuffer("buf-new")
    expect(readBroadcastBufferSince("buf-new", 0)).toEqual([])
  })

  it("returns null when no buffer exists and the cursor is > 0 (server restart scenario)", async () => {
    const { readBroadcastBufferSince, clearBroadcastBuffer } = await import("../session-manager.js")
    clearBroadcastBuffer("buf-missing")
    expect(readBroadcastBufferSince("buf-missing", 7)).toBeNull()
  })

  it("does not buffer lifecycle events (session_complete, ask_user_question, presence)", async () => {
    const { broadcastToSession, readBroadcastBufferSince, clearBroadcastBuffer } =
      await import("../session-manager.js")

    clearBroadcastBuffer("buf-life")
    broadcastToSession("buf-life", { type: "session_complete", status: "complete" })
    broadcastToSession("buf-life", { type: "ask_user_question", questions: [] })
    broadcastToSession("buf-life", { type: "presence", users: [] })

    expect(readBroadcastBufferSince("buf-life", 0)).toEqual([])
  })

  it("clearBroadcastBuffer drops the buffer (used on session completion)", async () => {
    const { broadcastToSession, readBroadcastBufferSince, clearBroadcastBuffer } =
      await import("../session-manager.js")

    clearBroadcastBuffer("buf-clear")
    broadcastToSession("buf-clear", { sequence: 1, message: {} })
    clearBroadcastBuffer("buf-clear")
    expect(readBroadcastBufferSince("buf-clear", 0)).toEqual([])
    expect(readBroadcastBufferSince("buf-clear", 5)).toBeNull()
  })
})
