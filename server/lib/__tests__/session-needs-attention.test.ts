import { vi, describe, it, expect, beforeEach } from "vitest"

// Track execute calls so we can inspect which transitions the CAS allows.
const executeMock = vi.fn(async () => ({ rowCount: 1 }))

vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => undefined),
  execute: (...args: unknown[]) => executeMock(...(args as [])),
  withTransaction: vi.fn(async (fn: any) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}))

vi.mock("../../lib/credentials.js", () => ({
  getAgentEnv: () => ({}),
}))

// A session whose agent process exited while parked on AskUserQuestion should be
// recoverable: status transitions from awaiting_user_input → needs_attention,
// then from needs_attention → running when the user answers (the /answer route
// falls back to resumeSessionQuery, which sets status to "running").
describe("needs_attention status transitions", () => {
  beforeEach(() => {
    executeMock.mockClear()
    executeMock.mockResolvedValue({ rowCount: 1 })
  })

  it("Scenario: Iterator crashes mid-question → status becomes `needs_attention`, question stays answerable — allows awaiting_user_input → needs_attention", async () => {
    const { updateSessionStatus } = await import("../session-manager.js")
    await updateSessionStatus("s1", "needs_attention", "iterator crashed")
    // The atomic CAS update is the first SQL call.
    const call = executeMock.mock.calls[0]! as unknown as [string, unknown[]]
    const params = call[1]
    expect(params[0]).toBe("needs_attention")
    // valid source statuses array — must include awaiting_user_input and running
    const validSources = params[4] as string[]
    expect(validSources).toContain("awaiting_user_input")
    expect(validSources).toContain("running")
  })

  it("allows needs_attention → running (answer-triggered resume)", async () => {
    const { updateSessionStatus } = await import("../session-manager.js")
    await updateSessionStatus("s1", "running")
    const call = executeMock.mock.calls[0]! as unknown as [string, unknown[]]
    const params = call[1]
    expect(params[0]).toBe("running")
    const validSources = params[4] as string[]
    expect(validSources).toContain("needs_attention")
  })

  it("Scenario: Status flips to `awaiting_user_input` while a question is pending — running → awaiting_user_input is an allowed transition", async () => {
    const { updateSessionStatus } = await import("../session-manager.js")
    await updateSessionStatus("s1", "awaiting_user_input")
    const call = executeMock.mock.calls[0]! as unknown as [string, unknown[]]
    const params = call[1]
    expect(params[0]).toBe("awaiting_user_input")
    const validSources = params[4] as string[]
    // The agent parks on a question only from the running state.
    expect(validSources).toContain("running")
  })

  it("does not store error message as summary for needs_attention (yellow surface)", async () => {
    const { updateSessionStatus } = await import("../session-manager.js")
    await updateSessionStatus("s1", "needs_attention", "boom")
    const call = executeMock.mock.calls[0]! as unknown as [string, unknown[]]
    const params = call[1]
    // Summary slot — only `errored` blanks it; needs_attention keeps the supplied summary.
    // (The frontend doesn't surface this string anywhere user-visible — it just shouldn't
    // be nulled like the errored path does.)
    expect(params[1]).toBe("boom")
  })
})
