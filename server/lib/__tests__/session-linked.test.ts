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
  })

  it("sets linked_email_thread_id when attaching an email source", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    attachSourceToSession("sess-1", {
      type: "email",
      id: "thread-123",
      title: "Test email",
      content: "Email content",
    })

    const emailUpdate = mockRun.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("linked_email_thread_id"),
    )
    expect(emailUpdate).toBeDefined()
    expect(emailUpdate![1]).toBe("thread-123")
  })

  it("sets linked_task_id when attaching a task source", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    attachSourceToSession("sess-1", {
      type: "task",
      id: "task-456",
      title: "Test task",
      content: "Task content",
    })

    const taskUpdate = mockRun.mock.calls.find(
      ([sql]: [string]) => typeof sql === "string" && sql.includes("linked_task_id"),
    )
    expect(taskUpdate).toBeDefined()
    expect(taskUpdate![1]).toBe("task-456")
  })

  it("does not set type-specific columns for other source types", async () => {
    const { attachSourceToSession } = await import("../session-manager.js")
    attachSourceToSession("sess-1", {
      type: "calendar",
      id: "cal-789",
      title: "Test event",
      content: "Event content",
    })

    const typeSpecificUpdate = mockRun.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === "string" &&
        (sql.includes("linked_email_thread_id") || sql.includes("linked_task_id")),
    )
    expect(typeSpecificUpdate).toBeUndefined()
  })
})
