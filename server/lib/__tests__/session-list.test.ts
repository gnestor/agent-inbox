import { vi, describe, it, expect, beforeEach } from "vitest"

let capturedSql = ""
const mockQuery = vi.fn<(...args: any[]) => Promise<any[]>>(async () => [])

vi.mock("../../db/pool.js", () => ({
  query: (...args: any[]) => {
    capturedSql = args[0]
    return mockQuery(...args)
  },
  queryOne: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({ rowCount: 0 })),
  withTransaction: vi.fn(async (fn: any) => fn({
    query: vi.fn(async () => ({ rows: [] })),
  })),
}))

vi.mock("../../lib/credentials.js", () => ({
  getAgentEnv: () => ({}),
}))

describe("listSessionRecords", () => {
  beforeEach(() => {
    vi.resetModules()
    capturedSql = ""
    mockQuery.mockResolvedValue([])
  })

  it("extracts linked_item_title via ->> on metadata", async () => {
    const { listSessionRecords } = await import("../session-manager.js")
    await listSessionRecords()
    expect(capturedSql).toContain("linked_item_title")
    expect(capturedSql).toContain("->>'linkedItemTitle'")
    expect(capturedSql).not.toContain("processed_emails")
  })

  it("returns linked_item_title from metadata", async () => {
    const row = {
      id: "sess-1",
      status: "complete",
      prompt: "test",
      summary: null,
      started_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      completed_at: null,
      linked_email_id: "email-1",
      linked_email_thread_id: "thread-1",
      linked_task_id: null,
      trigger_source: "inbox",
      metadata: JSON.stringify({ linkedItemTitle: "Re: Invoice Q1" }),
      linked_item_title: "Re: Invoice Q1",
    }
    mockQuery.mockResolvedValue([row])
    const { listSessionRecords } = await import("../session-manager.js")
    const results = await listSessionRecords()
    expect(results[0]!).toMatchObject({ linked_item_title: "Re: Invoice Q1" })
  })
})
