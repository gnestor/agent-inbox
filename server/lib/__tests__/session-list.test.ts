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

  it("extracts linked_item_title via json_extract on metadata", async () => {
    const { listSessionRecords } = await import("../session-manager.js")
    listSessionRecords()
    expect(capturedSql).toContain("linked_item_title")
    expect(capturedSql).toContain("json_extract")
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
    mockAll.mockReturnValue([row])
    const { listSessionRecords } = await import("../session-manager.js")
    const results = listSessionRecords()
    expect(results[0]).toMatchObject({ linked_item_title: "Re: Invoice Q1" })
  })
})
