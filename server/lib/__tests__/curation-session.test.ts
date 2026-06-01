import { vi, describe, it, expect, beforeEach } from "vitest"

// --- Mock the DB pool and session-manager that curation-session imports ---

const mockQueryOne = vi.fn<(...a: unknown[]) => Promise<unknown>>()
const mockExecute = vi.fn<(...a: unknown[]) => Promise<{ rowCount: number }>>()
const mockStartSession = vi.fn<(...a: unknown[]) => Promise<string>>()

vi.mock("../../db/pool.js", () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  execute: (...a: unknown[]) => mockExecute(...a),
}))

vi.mock("../session-manager.js", () => ({
  startSession: (...a: unknown[]) => mockStartSession(...a),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockQueryOne.mockResolvedValue(undefined) // no existing lock
  mockExecute.mockResolvedValue({ rowCount: 1 }) // claim succeeds by default
  mockStartSession.mockResolvedValue("sess-123")
})

describe("getCurationCwd", () => {
  it("Scenario: Curation sessions run with CWD = `${workspacePath}/context` — joins workspace path with `context`", async () => {
    const { getCurationCwd } = await import("../curation-session.js")
    expect(getCurationCwd("/home/u/agent")).toBe("/home/u/agent/context")
  })
})

describe("runBackgroundCurationSession", () => {
  function baseOpts(onComplete = vi.fn()) {
    return {
      workspacePath: "/home/u/agent",
      workspaceId: "agent",
      pendingKey: "entity-curation:person:foo@example.com",
      prompt: "curate it",
      linkedItemTitle: "Entity curation",
      onComplete,
    }
  }

  it("Scenario: `runBackgroundCurationSession` claims the pending row atomically — INSERT before startSession; concurrent claim is skipped", async () => {
    const { runBackgroundCurationSession } = await import("../curation-session.js")

    // First the claim INSERT, then later UPDATE-with-session-id.
    const res = await runBackgroundCurationSession(baseOpts())
    expect(res).toEqual({ sessionId: "sess-123" })

    // The atomic claim INSERT must run BEFORE startSession.
    const insertCallIdx = mockExecute.mock.calls.findIndex((c) =>
      String(c[0]).includes("INSERT INTO backfill_state"),
    )
    expect(insertCallIdx).toBeGreaterThanOrEqual(0)
    const insertOrder = mockExecute.mock.invocationCallOrder[insertCallIdx]
    const startOrder = mockStartSession.mock.invocationCallOrder[0]
    expect(insertOrder).toBeLessThan(startOrder!)
    expect(String(mockExecute.mock.calls[insertCallIdx]![0])).toContain("ON CONFLICT")
  })

  it("returns locked-skip when an existing fresh lock is held", async () => {
    // Existing row with a very recent last_run_at → within STALE_LOCK_MS.
    mockQueryOne.mockResolvedValue({ last_cursor: "other-sess|x", last_run_at: new Date().toISOString() })
    const { runBackgroundCurationSession } = await import("../curation-session.js")
    const res = await runBackgroundCurationSession(baseOpts())
    expect("skipped" in res).toBe(true)
    expect(mockStartSession).not.toHaveBeenCalled()
  })

  it("Scenario: Curation sessions skip `sessions` DB rows — startSession is called with skipDbRecord: true", async () => {
    const { runBackgroundCurationSession } = await import("../curation-session.js")
    await runBackgroundCurationSession(baseOpts())
    expect(mockStartSession).toHaveBeenCalledWith(
      "curate it",
      expect.objectContaining({ skipDbRecord: true, workspacePath: "/home/u/agent/context" }),
    )
  })

  it("Scenario: `onComplete` fires exactly once at end-of-stream — invoked on status 'complete' and pending row released", async () => {
    const onComplete = vi.fn(async () => {})
    // Capture the onEnd callback startSession receives so we can drive it.
    let onEnd: ((sid: string, status: string) => Promise<void>) | undefined
    mockStartSession.mockImplementation(async (_prompt: unknown, opts: any) => {
      onEnd = opts.onEnd
      return "sess-123"
    })

    const { runBackgroundCurationSession } = await import("../curation-session.js")
    await runBackgroundCurationSession(baseOpts(onComplete))

    expect(onComplete).not.toHaveBeenCalled() // not until the stream completes
    await onEnd!("sess-123", "complete")
    expect(onComplete).toHaveBeenCalledTimes(1)

    // A non-complete status does NOT call onComplete again.
    await onEnd!("sess-123", "errored")
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
