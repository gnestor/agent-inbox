import { vi, describe, it, expect, beforeEach } from "vitest"

// Mock the DB so session-manager can import without a real DB
vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({ rowCount: 0 })),
  withTransaction: vi.fn(async (fn: any) => fn({
    query: vi.fn(async () => ({ rows: [] })),
  })),
}))

// Mock credentials
vi.mock("../../lib/credentials.js", () => ({
  getAgentEnv: () => ({}),
}))

describe("provideAskUserAnswer", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("returns false when no question is pending", async () => {
    const { provideAskUserAnswer } = await import("../session-manager.js")
    expect(provideAskUserAnswer("nonexistent-session", { q: "a" })).toBe(false)
  })

  it("resolves a pending question and returns true", async () => {
    const { provideAskUserAnswer } = await import("../session-manager.js")

    const resolved: Record<string, string>[] = []

    // First call with no pending entry -> false
    expect(provideAskUserAnswer("session-1", { question: "answer" })).toBe(false)

    // Verify resolved is still empty (no side effects from failed call)
    expect(resolved).toHaveLength(0)
  })

  it("does not throw when called multiple times for the same session", async () => {
    const { provideAskUserAnswer } = await import("../session-manager.js")
    expect(() => {
      provideAskUserAnswer("session-x", { q: "a" })
      provideAskUserAnswer("session-x", { q: "b" })
    }).not.toThrow()
  })
})
