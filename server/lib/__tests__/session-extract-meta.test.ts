import { describe, it, expect, vi } from "vitest"

vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({ rowCount: 0 })),
  withTransaction: vi.fn(async (fn: any) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}))

vi.mock("../../lib/credentials.js", () => ({
  getAgentEnv: () => ({}),
}))

const userMsg = (text: string, cwd = "/Users/test/ws") =>
  JSON.stringify({
    type: "user",
    cwd,
    message: { role: "user", content: [{ type: "text", text }] },
  })

const assistantMsg = (text = "ok") =>
  JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  })

const userStringMsg = (text: string, cwd = "/Users/test/ws") =>
  JSON.stringify({ type: "user", cwd, message: { role: "user", content: text } })

describe("extractSessionMeta", () => {
  it("treats <scheduled-task> as a real prompt and labels it as Routine", async () => {
    const { extractSessionMeta } = await import("../session-manager.js")
    const head = [
      JSON.stringify({ type: "queue-operation", operation: "enqueue" }),
      userStringMsg(
        `<scheduled-task name="process-hammies-agent-tasks" file="/x/SKILL.md">\nThis is an automated run.\n</scheduled-task>`,
      ),
      assistantMsg(),
    ]
    const meta = extractSessionMeta(head, [])
    expect(meta.cwd).toBe("/Users/test/ws")
    expect(meta.firstPrompt).toBe("Routine: process-hammies-agent-tasks")
    expect(meta.hasContent).toBe(true)
  })

  it("still skips <system-reminder> and <command-name> wrappers", async () => {
    const { extractSessionMeta } = await import("../session-manager.js")
    const head = [
      userStringMsg(`<system-reminder>noise</system-reminder>`),
      userStringMsg(`real follow-up message`),
    ]
    const meta = extractSessionMeta(head, [])
    expect(meta.firstPrompt).toBe("real follow-up message")
    expect(meta.hasContent).toBe(true)
  })

  it("skips system wrappers in array content but keeps real text", async () => {
    const { extractSessionMeta } = await import("../session-manager.js")
    const head = [
      JSON.stringify({
        type: "user",
        cwd: "/x",
        message: {
          role: "user",
          content: [
            { type: "text", text: "<system-reminder>noise</system-reminder>" },
            { type: "text", text: "real prompt content" },
          ],
        },
      }),
    ]
    const meta = extractSessionMeta(head, [])
    expect(meta.firstPrompt).toBe("real prompt content")
  })

  it("flags hasContent=false for sessions with only file-history-snapshot / queue-operation", async () => {
    const { extractSessionMeta } = await import("../session-manager.js")
    const head = [
      JSON.stringify({ type: "queue-operation", operation: "enqueue" }),
      JSON.stringify({ type: "file-history-snapshot", cwd: "/x" }),
      JSON.stringify({ type: "queue-operation", operation: "dequeue" }),
    ]
    const meta = extractSessionMeta(head, [])
    expect(meta.hasContent).toBe(false)
    expect(meta.firstPrompt).toBeNull()
  })

  it("hasContent=true even when firstPrompt is filtered out (only system wrappers)", async () => {
    const { extractSessionMeta } = await import("../session-manager.js")
    const head = [userStringMsg("<system-reminder>noise</system-reminder>"), assistantMsg()]
    const meta = extractSessionMeta(head, [])
    expect(meta.hasContent).toBe(true)
    expect(meta.firstPrompt).toBeNull()
  })

  it("extracts result summary from tail", async () => {
    const { extractSessionMeta } = await import("../session-manager.js")
    const head = [userMsg("hi")]
    const tail = [JSON.stringify({ type: "result", result: "all done" })]
    const meta = extractSessionMeta(head, tail)
    expect(meta.summary).toBe("all done")
  })

  it("regression: 3870ccf1-style session (scheduled-task, no result, no firstPrompt before fix) is now visible", async () => {
    const { extractSessionMeta } = await import("../session-manager.js")
    const head = [
      JSON.stringify({ type: "queue-operation", operation: "enqueue" }),
      JSON.stringify({ type: "queue-operation", operation: "dequeue" }),
      userStringMsg(
        `<scheduled-task name="process-hammies-agent-tasks" file="/x">\nRun directory: packages/agent/.claude/orchestrator/runs/review-and-dispute-shopify-collab-commi/\n</scheduled-task>`,
        "/Users/grant/Github/hammies/hammies-workspace/packages/agent",
      ),
    ]
    const meta = extractSessionMeta(head, [])
    expect(meta.hasContent).toBe(true)
    expect(meta.firstPrompt).toBe("Routine: process-hammies-agent-tasks")
    expect(meta.cwd).toBe("/Users/grant/Github/hammies/hammies-workspace/packages/agent")
    expect(meta.summary).toBeNull()
  })
})
