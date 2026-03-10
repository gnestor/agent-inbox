import { vi, describe, it, expect, beforeEach } from "vitest"

const mockGet = vi.fn()

vi.mock("../../db/schema.js", () => ({
  getDb: () => ({
    prepare: () => ({ get: mockGet, run: vi.fn(), all: vi.fn(() => []) }),
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
