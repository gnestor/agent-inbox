import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({ rowCount: 0 })),
  withTransaction: vi.fn(async (fn: any) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}))

vi.mock("../../lib/credentials.js", () => ({ getAgentEnv: () => ({}) }))
vi.mock("../../lib/title-generator.js", () => ({ generateSessionTitle: vi.fn().mockResolvedValue(null) }))

function jsonl(objs: object[]): string[] {
  return objs.map((o) => JSON.stringify(o))
}

describe("attached-context inlining", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("collects attached_context entries added after the last turn", async () => {
    const lines = jsonl([
      { type: "user", message: { content: "hi", role: "user" } },
      { type: "assistant", message: { content: [{ type: "text", text: "hello" }], stop_reason: "end_turn" } },
      { type: "system", subtype: "attached_context", sourceType: "gmail", sourceId: "m-123", title: "Email title", content: "email body text" },
      { type: "system", subtype: "attached_context", sourceType: "notion", sourceId: "p-456", title: "Note", content: "note body" },
    ])

    const { collectPendingAttachments } = await import("../session-manager.js")
    expect(collectPendingAttachments(lines)).toEqual([
      { sourceType: "gmail", sourceId: "m-123", title: "Email title", content: "email body text" },
      { sourceType: "notion", sourceId: "p-456", title: "Note", content: "note body" },
    ])
  })

  it("ignores attached_context entries before an intervening user/assistant turn", async () => {
    const lines = jsonl([
      { type: "system", subtype: "attached_context", sourceType: "gmail", sourceId: "old", title: "Old", content: "stale attachment" },
      { type: "user", message: { content: "prompt", role: "user" } },
      { type: "assistant", message: { content: [{ type: "text", text: "reply" }], stop_reason: "end_turn" } },
    ])

    const { collectPendingAttachments } = await import("../session-manager.js")
    expect(collectPendingAttachments(lines)).toEqual([])
  })

  it("returns empty for empty input", async () => {
    const { collectPendingAttachments } = await import("../session-manager.js")
    expect(collectPendingAttachments([])).toEqual([])
  })

  it("inlines attachments with delimiters before the user prompt", async () => {
    const { inlineAttachments } = await import("../session-manager.js")
    const out = inlineAttachments(
      "See this response regarding the payroll.",
      [
        { sourceType: "gmail", sourceId: "m-1", title: "RE: Payroll", content: "hello from gusto" },
      ],
    )
    expect(out).toContain('<attached_context source=gmail:m-1 title="RE: Payroll">')
    expect(out).toContain("hello from gusto")
    expect(out).toContain("</attached_context>")
    expect(out.endsWith("See this response regarding the payroll.")).toBe(true)
  })

  it("is a no-op when there are no attachments", async () => {
    const { inlineAttachments } = await import("../session-manager.js")
    expect(inlineAttachments("just a prompt", [])).toBe("just a prompt")
  })
})
