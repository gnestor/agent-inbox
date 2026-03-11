import { vi, describe, it, expect, beforeEach } from "vitest"

let capturedSql = ""
const mockAll = vi.fn(() => [])

vi.mock("../../db/schema.js", () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      capturedSql = sql
      return { all: mockAll, run: vi.fn(), get: vi.fn() }
    },
  }),
}))

vi.mock("../../lib/credentials.js", () => ({
  getAgentEnv: () => ({}),
}))

describe("listSessionRecords", () => {
  beforeEach(() => {
    vi.resetModules()
    capturedSql = ""
    mockAll.mockReturnValue([])
  })

  it("includes LEFT JOIN with processed_emails for email subject", async () => {
    const { listSessionRecords } = await import("../session-manager.js")
    listSessionRecords()
    expect(capturedSql).toContain("processed_emails")
    expect(capturedSql).toContain("linked_email_subject")
  })

  it("includes linked_task_title via json_extract on metadata", async () => {
    const { listSessionRecords } = await import("../session-manager.js")
    listSessionRecords()
    expect(capturedSql).toContain("linked_task_title")
    expect(capturedSql).toContain("json_extract")
  })

  it("returns linked_email_subject from joined row", async () => {
    const row = {
      id: "sess-1",
      status: "complete",
      prompt: "test",
      summary: null,
      started_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      completed_at: null,
      message_count: 0,
      linked_email_id: "email-1",
      linked_email_thread_id: "thread-1",
      linked_task_id: null,
      trigger_source: "inbox",
      metadata: null,
      linked_email_subject: "Re: Invoice Q1",
      linked_task_title: null,
    }
    mockAll.mockReturnValue([row])
    const { listSessionRecords } = await import("../session-manager.js")
    const results = listSessionRecords()
    expect(results[0]).toMatchObject({ linked_email_subject: "Re: Invoice Q1" })
  })
})
