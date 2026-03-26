import { vi, describe, it, expect, beforeEach } from "vitest"

const mockGet = vi.fn()
const mockRun = vi.fn()
const mockAll = vi.fn(() => [])

vi.mock("../../db/schema.js", () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: mockGet,
      run: (...args: unknown[]) => mockRun(sql, ...args),
      all: mockAll,
    }),
  }),
}))

vi.mock("../../lib/credentials.js", () => ({
  getAgentEnv: () => ({}),
}))

describe("getLinkedSession", () => {
  beforeEach(() => {
    vi.resetModules()
    mockGet.mockReturnValue(null)
  })

  it("returns undefined when neither threadId nor taskId is provided", async () => {
    const { getLinkedSession } = await import("../session-manager.js")
    expect(getLinkedSession()).toBeUndefined()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it("returns undefined when no session matches the threadId", async () => {
    mockGet.mockReturnValue(null)
    const { getLinkedSession } = await import("../session-manager.js")
    expect(getLinkedSession("nonexistent-thread")).toBeNull()
  })

  it("returns session when threadId matches", async () => {
    const session = { id: "sess-1", status: "complete", linked_email_thread_id: "thread-1" }
    mockGet.mockReturnValue(session)
    const { getLinkedSession } = await import("../session-manager.js")
    const result = getLinkedSession("thread-1")
    expect(result).toEqual(session)
  })

  it("returns session when taskId matches", async () => {
    const session = { id: "sess-2", status: "running", linked_task_id: "task-1" }
    mockGet.mockReturnValue(session)
    const { getLinkedSession } = await import("../session-manager.js")
    const result = getLinkedSession(undefined, "task-1")
    expect(result).toEqual(session)
  })

  it("prefers threadId over taskId when both provided", async () => {
    const session = { id: "sess-1", linked_email_thread_id: "thread-1" }
    mockGet.mockReturnValue(session)
    const { getLinkedSession } = await import("../session-manager.js")
    const result = getLinkedSession("thread-1", "task-1")
    expect(result?.linked_email_thread_id).toBe("thread-1")
  })
})

describe("attachSourceToSession", () => {
  beforeEach(() => {
    vi.resetModules()
    mockRun.mockClear()
    mockAll.mockReturnValue([])
    mockGet.mockReturnValue(null)
  })

  // Helper: find the single UPDATE call that writes linked_source_id
  function findUpdateCall() {
    return mockRun.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("linked_source_id"),
    )
  }

  it("sets linked_email_thread_id when attaching an email source", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    attachSourceToSession("sess-1", { type: "email", id: "thread-123", title: "Test email", content: "" })

    const call = findUpdateCall()
    expect(call).toBeDefined()
    // isEmail flag (index 4) = 1, email id (index 5) = source.id
    expect(call![4]).toBe(1)
    expect(call![5]).toBe("thread-123")
  })

  it("persists title in metadata when attaching a source", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    attachSourceToSession("sess-1", { type: "email", id: "thread-123", title: "Re: Invoice Q1", content: "" })

    const call = findUpdateCall()
    expect(call).toBeDefined()
    // title is passed as a direct parameter (index 3) to json_set in SQL
    expect(call![3]).toBe("Re: Invoice Q1")
  })

  it("sets linked_task_id when attaching a task source", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    attachSourceToSession("sess-1", { type: "task", id: "task-456", title: "Test task", content: "" })

    const call = findUpdateCall()
    expect(call).toBeDefined()
    // isTask flag (index 6) = 1, task id (index 7) = source.id
    expect(call![6]).toBe(1)
    expect(call![7]).toBe("task-456")
  })

  it("does not set type-specific columns for other source types", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    attachSourceToSession("sess-1", { type: "calendar", id: "cal-789", title: "Test event", content: "" })

    const call = findUpdateCall()
    expect(call).toBeDefined()
    // Both CASE WHEN flags are 0, so legacy columns are unchanged
    expect(call![4]).toBe(0) // isEmail = false
    expect(call![6]).toBe(0) // isTask = false
  })
})
