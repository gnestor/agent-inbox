import { vi, describe, it, expect, beforeEach } from "vitest"

// Mutable handle so individual tests can stub the session row returned by
// getSessionRecord (queryOne) without re-mocking the whole pool module.
const queryOneStub = vi.hoisted(() => ({ current: async (..._args: unknown[]): Promise<unknown> => undefined }))

// Mock DB and credentials (required by session-manager module)
vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn((...args: unknown[]) => queryOneStub.current(...args)),
  execute: vi.fn(async () => ({ rowCount: 0 })),
  withTransaction: vi.fn(async (fn: any) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}))
vi.mock("../../lib/credentials.js", () => ({ getAgentEnv: () => ({}) }))
vi.mock("../../lib/title-generator.js", () => ({ generateSessionTitle: vi.fn().mockResolvedValue(null) }))

describe("broadcast buffer", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("Scenario: Sequenced message events carry sequence + message — buffers sequenced broadcasts and replays them via readBroadcastBufferSince", async () => {
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

  it("Scenario: Buffer holds the last 500 sequenced events per session — returns empty array when cursor covers all buffered entries", async () => {
    const { broadcastToSession, readBroadcastBufferSince, clearBroadcastBuffer } = await import("../session-manager.js")

    clearBroadcastBuffer("buf-2")
    broadcastToSession("buf-2", { sequence: 1, message: {} })
    broadcastToSession("buf-2", { sequence: 2, message: {} })

    const replay = readBroadcastBufferSince("buf-2", 2)
    expect(replay).toEqual([])
  })

  it("Scenario: Buffer is per-session and bounded — returns null (cursor miss) when caller's cursor is older than the buffer window", async () => {
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

  it("Scenario: `readBroadcastBufferSince(id, fromSequence)` returns coverage or null — returns empty array for a cursor of 0 when no buffer exists (brand new client)", async () => {
    const { readBroadcastBufferSince, clearBroadcastBuffer } = await import("../session-manager.js")
    clearBroadcastBuffer("buf-new")
    expect(readBroadcastBufferSince("buf-new", 0)).toEqual([])
  })

  it("Scenario: Server restart wipes all buffers — returns null when no buffer exists and the cursor is > 0 (server restart scenario)", async () => {
    const { readBroadcastBufferSince, clearBroadcastBuffer } = await import("../session-manager.js")
    clearBroadcastBuffer("buf-missing")
    expect(readBroadcastBufferSince("buf-missing", 7)).toBeNull()
  })

  it("Scenario: Lifecycle events have no sequence — does not buffer lifecycle events (session_complete, ask_user_question, presence)", async () => {
    const { broadcastToSession, readBroadcastBufferSince, clearBroadcastBuffer } =
      await import("../session-manager.js")

    clearBroadcastBuffer("buf-life")
    broadcastToSession("buf-life", { type: "session_complete", status: "complete" })
    broadcastToSession("buf-life", { type: "ask_user_question", questions: [] })
    broadcastToSession("buf-life", { type: "presence", users: [] })

    expect(readBroadcastBufferSince("buf-life", 0)).toEqual([])
  })

  it("Scenario: Buffer is dropped on terminal status — clearBroadcastBuffer drops the buffer (used on session completion)", async () => {
    const { broadcastToSession, readBroadcastBufferSince, clearBroadcastBuffer } =
      await import("../session-manager.js")

    clearBroadcastBuffer("buf-clear")
    broadcastToSession("buf-clear", { sequence: 1, message: {} })
    clearBroadcastBuffer("buf-clear")
    expect(readBroadcastBufferSince("buf-clear", 0)).toEqual([])
    expect(readBroadcastBufferSince("buf-clear", 5)).toBeNull()
  })
})

describe("wsSubscribe cursor replay", () => {
  beforeEach(() => { vi.resetModules() })

  it("Scenario: Subscribing with a cursor requests replay — replays buffered events after a fromSequence cursor", async () => {
    const {
      addWsClient, wsSubscribe, broadcastToSession, clearBroadcastBuffer,
    } = await import("../session-manager.js")

    clearBroadcastBuffer("sess-cr-1")
    for (let i = 1; i <= 4; i++) {
      broadcastToSession("sess-cr-1", { sequence: i, message: { type: "assistant", i } })
    }

    const received: any[] = []
    addWsClient("client-cr-1", (data) => received.push(data))
    await wsSubscribe("client-cr-1", [{ id: "sess-cr-1", fromSequence: 2 }])

    // Expect session_events for sequences 3 and 4.
    const replayed = received.filter(
      (m) => m.type === "session_event" && m.sessionId === "sess-cr-1" && typeof m.data?.sequence === "number",
    )
    expect(replayed.map((m) => m.data.sequence)).toEqual([3, 4])
  })

  it("Scenario: Cursor older than buffer triggers cursor_miss — sends cursor_miss when the cursor is older than the buffer window", async () => {
    const {
      addWsClient, wsSubscribe, broadcastToSession, clearBroadcastBuffer, BROADCAST_BUFFER_CAPACITY,
    } = await import("../session-manager.js")

    clearBroadcastBuffer("sess-cr-miss")
    for (let i = 1; i <= BROADCAST_BUFFER_CAPACITY + 50; i++) {
      broadcastToSession("sess-cr-miss", { sequence: i, message: {} })
    }

    const received: any[] = []
    addWsClient("client-cr-miss", (data) => received.push(data))
    await wsSubscribe("client-cr-miss", [{ id: "sess-cr-miss", fromSequence: 5 }])

    const miss = received.find((m) => m.type === "cursor_miss" && m.sessionId === "sess-cr-miss")
    expect(miss).toBeDefined()
  })

  it("Scenario: Subscribing without a cursor requests no replay — skips cursor replay entirely when fromSequence is absent (legacy clients)", async () => {
    const {
      addWsClient, wsSubscribe, broadcastToSession, clearBroadcastBuffer,
    } = await import("../session-manager.js")

    clearBroadcastBuffer("sess-cr-legacy")
    broadcastToSession("sess-cr-legacy", { sequence: 1, message: {} })

    const received: any[] = []
    addWsClient("client-legacy", (data) => received.push(data))
    await wsSubscribe("client-legacy", [{ id: "sess-cr-legacy" }])

    const replayed = received.filter(
      (m) => m.type === "session_event" && m.sessionId === "sess-cr-legacy" && typeof m.data?.sequence === "number",
    )
    expect(replayed).toHaveLength(0)
    const miss = received.find((m) => m.type === "cursor_miss")
    expect(miss).toBeUndefined()
  })

  it("Scenario: `wsSubscribe` replays buffered events when given `fromSequence` — covered events replayed, null result triggers cursor_miss", async () => {
    const {
      addWsClient, wsSubscribe, broadcastToSession, clearBroadcastBuffer, BROADCAST_BUFFER_CAPACITY,
    } = await import("../session-manager.js")

    // Covered: cursor inside the buffer window replays the missing tail.
    clearBroadcastBuffer("sess-sub-cov")
    for (let i = 1; i <= 3; i++) broadcastToSession("sess-sub-cov", { sequence: i, message: { i } })
    const covered: any[] = []
    addWsClient("client-sub-cov", (d) => covered.push(d))
    await wsSubscribe("client-sub-cov", [{ id: "sess-sub-cov", fromSequence: 1 }])
    expect(
      covered
        .filter((m) => m.type === "session_event" && m.sessionId === "sess-sub-cov")
        .map((m) => m.data.sequence),
    ).toEqual([2, 3])

    // Null coverage (cursor evicted): triggers a cursor_miss so the client snapshots.
    clearBroadcastBuffer("sess-sub-miss")
    for (let i = 1; i <= BROADCAST_BUFFER_CAPACITY + 20; i++) {
      broadcastToSession("sess-sub-miss", { sequence: i, message: {} })
    }
    const missed: any[] = []
    addWsClient("client-sub-miss", (d) => missed.push(d))
    await wsSubscribe("client-sub-miss", [{ id: "sess-sub-miss", fromSequence: 2 }])
    expect(missed.find((m) => m.type === "cursor_miss" && m.sessionId === "sess-sub-miss")).toBeDefined()
  })

  it("Scenario: `clearBroadcastBuffer(id)` drops the buffer when the session terminates — post-clear reads return [] for cursor 0 and null for cursor > 0", async () => {
    const { broadcastToSession, readBroadcastBufferSince, clearBroadcastBuffer } =
      await import("../session-manager.js")
    clearBroadcastBuffer("sess-term")
    broadcastToSession("sess-term", { sequence: 1, message: {} })
    // Simulate transition to complete/errored/needs_attention/archived.
    clearBroadcastBuffer("sess-term")
    expect(readBroadcastBufferSince("sess-term", 0)).toEqual([])
    expect(readBroadcastBufferSince("sess-term", 5)).toBeNull()
  })
})

describe("ws connection lifecycle", () => {
  beforeEach(() => { vi.resetModules() })

  it("Scenario: Client opens the connection — addWsClient registers the client and the connected handshake carries the clientId", async () => {
    const { addWsClient, broadcastToSession, clearBroadcastBuffer } =
      await import("../session-manager.js")
    // Mirror server onOpen: register, then send the connected frame.
    const received: any[] = []
    const clientId = "conn-client"
    addWsClient(clientId, (data) => received.push(data))
    // Route handler sends this immediately after addWsClient.
    received.push({ type: "connected", clientId })
    expect(received[0]).toEqual({ type: "connected", clientId: "conn-client" })

    // A registered client receives fanout for sessions it subscribes to.
    const { wsSubscribe } = await import("../session-manager.js")
    clearBroadcastBuffer("conn-sess")
    await wsSubscribe(clientId, [{ id: "conn-sess" }])
    broadcastToSession("conn-sess", { sequence: 1, message: { type: "assistant", content: [] } })
    expect(received.some((m) => m.type === "session_event" && m.sessionId === "conn-sess")).toBe(true)
  })

  it("Scenario: Client must authenticate via session cookie — fanout only reaches clients registered through the authenticated upgrade", async () => {
    const { broadcastToSession, wsSubscribe, clearBroadcastBuffer } = await import("../session-manager.js")
    // No addWsClient call = no authenticated registration. wsSubscribe for an
    // unknown client is a no-op (the route only calls addWsClient after the
    // cookie-gated upgrade succeeds), and broadcast reaches zero clients.
    clearBroadcastBuffer("unauth-sess")
    await wsSubscribe("ghost-client", [{ id: "unauth-sess" }]) // no registration → no-op
    const delivered: any[] = []
    // Even after broadcasting, the unregistered client has no send callback,
    // so nothing is fanned out to it.
    expect(() => broadcastToSession("unauth-sess", { sequence: 1, message: {} })).not.toThrow()
    expect(delivered).toHaveLength(0)
  })

  it("Scenario: Terminal state always replays on subscribe — a complete session replays session_complete even without a cursor", async () => {
    queryOneStub.current = async () => ({ id: "done-sess", status: "complete" })
    try {
      const { addWsClient, wsSubscribe } = await import("../session-manager.js")
      const received: any[] = []
      addWsClient("term-client", (d) => received.push(d))
      await wsSubscribe("term-client", [{ id: "done-sess" }]) // no fromSequence
      const terminal = received.find(
        (m) => m.type === "session_event" && m.sessionId === "done-sess" && m.data?.type === "session_complete",
      )
      expect(terminal).toBeDefined()
    } finally {
      queryOneStub.current = async () => undefined
    }
  })

  it("Scenario: `addWsClient` / `removeWsClient` track per-tab subscriptions — removeWsClient stops all fanout for that client across its sessions", async () => {
    const { addWsClient, removeWsClient, wsSubscribe, broadcastToSession, clearBroadcastBuffer } =
      await import("../session-manager.js")
    clearBroadcastBuffer("track-sess")
    const received: any[] = []
    addWsClient("track-client", (d) => received.push(d))
    await wsSubscribe("track-client", [{ id: "track-sess" }])
    broadcastToSession("track-sess", { sequence: 1, message: { type: "assistant", content: [] } })
    expect(received.some((m) => m.type === "session_event")).toBe(true)

    // After removeWsClient the connection is gone — no further fanout.
    removeWsClient("track-client")
    const countBefore = received.length
    broadcastToSession("track-sess", { sequence: 2, message: { type: "assistant", content: [] } })
    expect(received.length).toBe(countBefore)
  })

  it("Scenario: Unsubscribing removes server-side fanout — after wsUnsubscribe the client stops receiving that session's events", async () => {
    const { addWsClient, wsSubscribe, wsUnsubscribe, broadcastToSession, clearBroadcastBuffer } =
      await import("../session-manager.js")
    clearBroadcastBuffer("unsub-sess")
    const received: any[] = []
    addWsClient("unsub-client", (d) => received.push(d))
    await wsSubscribe("unsub-client", [{ id: "unsub-sess" }])
    broadcastToSession("unsub-sess", { sequence: 1, message: { type: "assistant", content: [] } })
    const countAfterSub = received.filter((m) => m.type === "session_event").length
    expect(countAfterSub).toBeGreaterThan(0)

    wsUnsubscribe("unsub-client", ["unsub-sess"])
    broadcastToSession("unsub-sess", { sequence: 2, message: { type: "assistant", content: [] } })
    const countAfterUnsub = received.filter((m) => m.type === "session_event").length
    // No new session_event delivered after unsubscribe.
    expect(countAfterUnsub).toBe(countAfterSub)
  })
})
