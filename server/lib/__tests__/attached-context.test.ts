import { describe, it, expect, vi, beforeEach } from "vitest"
import { writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir, homedir } from "os"

vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({ rowCount: 0 })),
  withTransaction: vi.fn(async (fn: any) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}))

vi.mock("../../lib/credentials.js", () => ({ getAgentEnv: () => ({}) }))
vi.mock("../../lib/title-generator.js", () => ({ generateSessionTitle: vi.fn().mockResolvedValue(null) }))

const TEST_DIR = join(tmpdir(), "test-attached-context")
const ENCODED_DIR = TEST_DIR.replace(/\//g, "-")
const PROJECT_DIR = join(homedir(), ".claude", "projects", ENCODED_DIR)

function writeJsonl(sessionId: string, lines: object[]) {
  mkdirSync(PROJECT_DIR, { recursive: true })
  writeFileSync(
    join(PROJECT_DIR, `${sessionId}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  )
}

describe("attached-context inlining", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("collects attached_context entries added after the last turn", async () => {
    writeJsonl("sess-1", [
      { type: "user", message: { content: "hi", role: "user" }, timestamp: "2026-04-22T00:00:00Z" },
      { type: "assistant", message: { content: [{ type: "text", text: "hello" }], stop_reason: "end_turn" }, timestamp: "2026-04-22T00:00:01Z" },
      { type: "system", subtype: "attached_context", sourceType: "gmail", sourceId: "m-123", title: "Email title", content: "email body text" },
      { type: "system", subtype: "attached_context", sourceType: "notion", sourceId: "p-456", title: "Note", content: "note body" },
    ])

    const { collectPendingAttachments } = await import("../session-manager.js")
    const pending = collectPendingAttachments("sess-1", TEST_DIR)

    expect(pending).toEqual([
      { sourceType: "gmail", sourceId: "m-123", title: "Email title", content: "email body text" },
      { sourceType: "notion", sourceId: "p-456", title: "Note", content: "note body" },
    ])
  })

  it("ignores attached_context entries before an intervening user/assistant turn", async () => {
    writeJsonl("sess-2", [
      { type: "system", subtype: "attached_context", sourceType: "gmail", sourceId: "old", title: "Old", content: "stale attachment" },
      { type: "user", message: { content: "prompt", role: "user" }, timestamp: "2026-04-22T00:00:00Z" },
      { type: "assistant", message: { content: [{ type: "text", text: "reply" }], stop_reason: "end_turn" }, timestamp: "2026-04-22T00:00:01Z" },
    ])

    const { collectPendingAttachments } = await import("../session-manager.js")
    expect(collectPendingAttachments("sess-2", TEST_DIR)).toEqual([])
  })

  it("returns empty when no JSONL exists", async () => {
    const { collectPendingAttachments } = await import("../session-manager.js")
    expect(collectPendingAttachments("does-not-exist", TEST_DIR)).toEqual([])
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
