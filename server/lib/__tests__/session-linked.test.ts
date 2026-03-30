import { vi, describe, it, expect, beforeEach } from "vitest"

const mockQueryOne = vi.fn(async () => undefined)
const mockExecute = vi.fn(async () => ({ rowCount: 0 }))
const mockQuery = vi.fn(async () => [])

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

describe("getLinkedSession", () => {
  beforeEach(() => {
    vi.resetModules()
    mockQueryOne.mockResolvedValue(undefined)
  })

  it("returns undefined when no sourceType/sourceId provided", async () => {
    const { getLinkedSession } = await import("../session-manager.js")
    expect(await getLinkedSession()).toBeUndefined()
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it("returns undefined when no session matches", async () => {
    mockQueryOne.mockResolvedValue(undefined)
    const { getLinkedSession } = await import("../session-manager.js")
    expect(await getLinkedSession("gmail", "nonexistent-thread")).toBeUndefined()
  })

  it("returns session when sourceType and sourceId match", async () => {
    const session = { id: "sess-1", status: "complete", linked_source_type: "gmail", linked_source_id: "thread-1" }
    mockQueryOne.mockResolvedValue(session)
    const { getLinkedSession } = await import("../session-manager.js")
    const result = await getLinkedSession("gmail", "thread-1")
    expect(result).toEqual(session)
  })

  it("queries with both sourceType and sourceId", async () => {
    const session = { id: "sess-2", linked_source_type: "notion-tasks", linked_source_id: "task-1" }
    mockQueryOne.mockResolvedValue(session)
    const { getLinkedSession } = await import("../session-manager.js")
    const result = await getLinkedSession("notion-tasks", "task-1")
    expect(result).toEqual(session)
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining("linked_source_type"),
      ["notion-tasks", "task-1"],
    )
  })
})

describe("attachSourceToSession", () => {
  beforeEach(() => {
    vi.resetModules()
    mockExecute.mockClear()
    mockQuery.mockResolvedValue([])
    mockQueryOne.mockResolvedValue(undefined)
  })

  function findUpdateCall() {
    return mockExecute.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("linked_source_id"),
    )
  }

  it("sets linked_source_id and linked_source_type when attaching a source", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    await attachSourceToSession("sess-1", { type: "gmail", id: "thread-123", title: "Test email", content: "" })

    const call = findUpdateCall()
    expect(call).toBeDefined()
    // params: [source.id, source.type, source.title, now, sessionId]
    expect(call![1][0]).toBe("thread-123")
    expect(call![1][1]).toBe("gmail")
  })

  it("persists title in metadata", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    await attachSourceToSession("sess-1", { type: "gmail", id: "thread-123", title: "Re: Invoice Q1", content: "" })

    const call = findUpdateCall()
    expect(call).toBeDefined()
    expect(call![1][2]).toBe("Re: Invoice Q1")
  })

  it("works for any source type", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    await attachSourceToSession("sess-1", { type: "notion-tasks", id: "task-456", title: "Test task", content: "" })

    const call = findUpdateCall()
    expect(call).toBeDefined()
    expect(call![1][0]).toBe("task-456")
    expect(call![1][1]).toBe("notion-tasks")
  })
})
