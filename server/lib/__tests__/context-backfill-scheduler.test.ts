import { vi, describe, it, expect, beforeEach } from "vitest"

// --- Mock heavy deps so we can drive runContextBackfill in isolation ---

const mockGetPlugins = vi.fn<(...a: unknown[]) => unknown[]>()
let resolveRawBackfill: (() => void) | undefined
const mockRunBackfill = vi.fn<(...a: unknown[]) => Promise<{ processed: number; total: number }>>()

vi.mock("../plugin-loader.js", () => ({
  getPlugins: (...a: unknown[]) => mockGetPlugins(...a),
}))
vi.mock("../../routes/backfill.js", () => ({
  runBackfill: (...a: unknown[]) => mockRunBackfill(...a),
}))
vi.mock("../../db/pool.js", () => ({
  queryOne: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({ rowCount: 0 })),
}))
vi.mock("../curation-session.js", () => ({
  runBackgroundCurationSession: vi.fn(async () => ({ skipped: "disabled" })),
  cleanupStaleCurationLocks: vi.fn(async () => 0),
}))

beforeEach(() => {
  vi.clearAllMocks()
  resolveRawBackfill = undefined
})

describe("runContextBackfill", () => {
  it("Scenario: Scheduler runs raw backfill every 30 minutes, single-process — runs raw indexing for query()+itemToContext() plugins and skips concurrent ticks", async () => {
    // Two plugins: one with query+itemToContext (eligible), one without.
    mockGetPlugins.mockReturnValue([
      { id: "gmail", query: () => [], itemToContext: () => "" },
      { id: "skills-only" }, // no query/itemToContext — must be filtered out
    ])

    // Make the first invocation hang until we release it so we can fire a
    // concurrent second tick and observe the isRunning guard.
    mockRunBackfill.mockImplementation(
      () =>
        new Promise((res) => {
          resolveRawBackfill = () => res({ processed: 1, total: 1 })
        }),
    )

    const { runContextBackfill } = await import("../context-backfill-scheduler.js")

    const first = runContextBackfill("/ws", "agent")
    // Second tick while the first is still running → skipped (isRunning guard).
    const second = await runContextBackfill("/ws", "agent")
    expect(second).toEqual({ raw: {}, curation: {} })

    resolveRawBackfill!()
    const firstResult = await first
    // Only the eligible plugin ran raw backfill.
    expect(mockRunBackfill).toHaveBeenCalledTimes(1)
    expect(firstResult.raw.gmail).toEqual({ processed: 1, total: 1 })
    expect(firstResult.raw["skills-only"]).toBeUndefined()
  })
})
