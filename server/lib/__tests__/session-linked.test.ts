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

  it("returns undefined when neither threadId nor taskId is provided", async () => {
    const { getLinkedSession } = await import("../session-manager.js")
    expect(await getLinkedSession()).toBeUndefined()
    expect(mockQueryOne).not.toHaveBeenCalled()
  })

  it("returns undefined when no session matches the threadId", async () => {
    mockQueryOne.mockResolvedValue(undefined)
    const { getLinkedSession } = await import("../session-manager.js")
    expect(await getLinkedSession("nonexistent-thread")).toBeUndefined()
  })

  it("returns session when threadId matches", async () => {
    const session = { id: "sess-1", status: "complete", linked_email_thread_id: "thread-1" }
    mockQueryOne.mockResolvedValue(session)
    const { getLinkedSession } = await import("../session-manager.js")
    const result = await getLinkedSession("thread-1")
    expect(result).toEqual(session)
  })

  it("returns session when taskId matches", async () => {
    const session = { id: "sess-2", status: "running", linked_task_id: "task-1" }
    mockQueryOne.mockResolvedValue(session)
    const { getLinkedSession } = await import("../session-manager.js")
    const result = await getLinkedSession(undefined, "task-1")
    expect(result).toEqual(session)
  })

  it("prefers threadId over taskId when both provided", async () => {
    const session = { id: "sess-1", linked_email_thread_id: "thread-1" }
    mockQueryOne.mockResolvedValue(session)
    const { getLinkedSession } = await import("../session-manager.js")
    const result = await getLinkedSession("thread-1", "task-1")
    expect(result?.linked_email_thread_id).toBe("thread-1")
  })
})

describe("attachSourceToSession", () => {
  beforeEach(() => {
    vi.resetModules()
    mockExecute.mockClear()
    mockQuery.mockResolvedValue([])
    mockQueryOne.mockResolvedValue(undefined)
  })

  // Helper: find the UPDATE call that writes linked_source_id
  function findUpdateCall() {
    return mockExecute.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("linked_source_id"),
    )
  }

  it("sets linked_email_thread_id when attaching an email source", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    await attachSourceToSession("sess-1", { type: "email", id: "thread-123", title: "Test email", content: "" })

    const call = findUpdateCall()
    expect(call).toBeDefined()
    // In the new PG query: params are [source.id, source.type, source.title, isEmail, isEmail ? source.id : null, isTask, isTask ? source.id : null, now, sessionId]
    // isEmail (index 3) = true, email id (index 4) = source.id
    expect(call![1][3]).toBe(true)
    expect(call![1][4]).toBe("thread-123")
  })

  it("persists title in metadata when attaching a source", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    await attachSourceToSession("sess-1", { type: "email", id: "thread-123", title: "Re: Invoice Q1", content: "" })

    const call = findUpdateCall()
    expect(call).toBeDefined()
    // title is param index 2
    expect(call![1][2]).toBe("Re: Invoice Q1")
  })

  it("sets linked_task_id when attaching a task source", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    await attachSourceToSession("sess-1", { type: "task", id: "task-456", title: "Test task", content: "" })

    const call = findUpdateCall()
    expect(call).toBeDefined()
    // isTask (index 5) = true, task id (index 6) = source.id
    expect(call![1][5]).toBe(true)
    expect(call![1][6]).toBe("task-456")
  })

  it("does not set type-specific columns for other source types", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    await attachSourceToSession("sess-1", { type: "calendar", id: "cal-789", title: "Test event", content: "" })

    const call = findUpdateCall()
    expect(call).toBeDefined()
    // isEmail = false, isTask = false
    expect(call![1][3]).toBe(false) // isEmail
    expect(call![1][5]).toBe(false) // isTask
  })
})
