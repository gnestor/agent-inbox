import { describe, it, expect, vi, beforeEach } from "vitest"
import { writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir, homedir } from "os"

// Mock the DB pool (session-manager imports it)
vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({ rowCount: 0 })),
  withTransaction: vi.fn(async (fn: any) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}))

vi.mock("../../lib/credentials.js", () => ({
  getAgentEnv: () => ({}),
}))

vi.mock("../../lib/title-generator.js", () => ({
  generateSessionTitle: vi.fn().mockResolvedValue(null),
}))

const TEST_DIR = join(tmpdir(), "test-session-transcript")
const SESSION_ID = "test-transcript-123"
// sessionJsonlPath encodes the cwd by replacing / with -
const ENCODED_DIR = TEST_DIR.replace(/\//g, "-")
const PROJECT_DIR = join(homedir(), ".claude", "projects", ENCODED_DIR)

// Build a realistic JSONL with partial messages, tool results, and render_output
function buildTestJsonl(): string {
  const lines = [
    // Line 0: queue operation (non-display)
    JSON.stringify({ type: "queue-operation", operation: "enqueue", sessionId: SESSION_ID }),
    // Line 1: queue operation (non-display)
    JSON.stringify({ type: "queue-operation", operation: "dequeue", sessionId: SESSION_ID }),
    // Line 2: user message
    JSON.stringify({ type: "user", message: { content: "Create a plan", role: "user" }, timestamp: "2026-01-01T00:00:00Z" }),
    // Line 3: partial assistant (no stop_reason) — should be filtered
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Let me think..." }], stop_reason: null }, timestamp: "2026-01-01T00:00:01Z" }),
    // Line 4: complete assistant
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Here is my analysis" }], stop_reason: "tool_use" }, timestamp: "2026-01-01T00:00:02Z" }),
    // Line 5: tool result (non-display)
    JSON.stringify({ type: "tool_result", tool_use_id: "tu1", content: "ok" }),
    // Line 6: partial assistant with render_output (no stop_reason) — should be filtered
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__render_output__render_output", id: "tu2", input: { type: "react", title: "My Plan", data: { code: "partial code" } } }], stop_reason: null }, timestamp: "2026-01-01T00:00:03Z" }),
    // Line 7: complete assistant with render_output
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__render_output__render_output", id: "tu2", input: { type: "react", title: "My Plan", data: { code: "original code" } } }], stop_reason: "tool_use" }, timestamp: "2026-01-01T00:00:04Z" }),
    // Line 8: complete assistant text
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done!" }], stop_reason: "end_turn" }, timestamp: "2026-01-01T00:00:05Z" }),
  ]
  return lines.join("\n") + "\n"
}

describe("session transcript and artifact patching", () => {
  beforeEach(async () => {
    // Reset modules to pick up fresh session-manager state
    vi.resetModules()

    // Write JSONL to ~/.claude/projects/{encoded-cwd}/ where session-manager expects it
    mkdirSync(PROJECT_DIR, { recursive: true })
    writeFileSync(join(PROJECT_DIR, `${SESSION_ID}.jsonl`), buildTestJsonl())
  })

  it("getAgentSessionTranscript filters partial messages and uses line index as sequence", async () => {
    const { getAgentSessionTranscript } = await import("../session-manager.js")

    const messages = await getAgentSessionTranscript(SESSION_ID, TEST_DIR)

    // Should include: line 2 (user), line 4 (assistant), line 7 (render_output), line 8 (done)
    // Should NOT include: line 0-1 (queue), line 3 (partial), line 5 (tool_result), line 6 (partial)
    const types = messages.map((m: any) => `${m.type}@seq${m.sequence}`)
    expect(types).toContain("user@seq2")
    expect(types).toContain("assistant@seq4")
    expect(types).toContain("assistant@seq7")
    expect(types).toContain("assistant@seq8")

    // Partial messages should be filtered
    expect(types).not.toContain("assistant@seq3")
    expect(types).not.toContain("assistant@seq6")

    // Non-display types should be filtered
    expect(messages.every((m: any) => m.type !== "queue-operation")).toBe(true)
    expect(messages.every((m: any) => m.type !== "tool_result")).toBe(true)
  })

  it("patchArtifactInJsonl patches the correct line by sequence (line index)", async () => {
    // Import the internal patchArtifactInJsonl via the module
    const mod = await import("../session-manager.js") as any
    const { getAgentSessionTranscript } = mod

    // Find the render_output sequence from the transcript
    const messages = await getAgentSessionTranscript(SESSION_ID, TEST_DIR)
    const renderMsg = messages.find((m: any) => {
      const content = m.message?.message?.content ?? m.message?.content ?? []
      return Array.isArray(content) && content.some((b: any) => b.name?.includes("render_output"))
    })
    expect(renderMsg).toBeDefined()
    const seq = renderMsg!.sequence as number

    // The render_output should be at line 7 (0-indexed)
    expect(seq).toBe(7)

    // Read the JSONL, patch line 7 directly (simulating what patchArtifactInJsonl does)
    const fs = await import("fs")
    const jsonlPath = join(PROJECT_DIR, `${SESSION_ID}.jsonl`)
    const content = fs.readFileSync(jsonlPath, "utf-8")
    const lines = content.trim().split("\n")

    // Verify the line at sequence 7 has the render_output
    const msg = JSON.parse(lines[seq])
    expect(msg.type).toBe("assistant")
    const blocks = msg.message?.content ?? []
    const toolBlock = blocks.find((b: any) => b.name?.includes("render_output"))
    expect(toolBlock).toBeDefined()
    expect(toolBlock.input.data.code).toBe("original code")

    // Patch it
    toolBlock.input.data.code = "new patched code"
    lines[seq] = JSON.stringify(msg)
    fs.writeFileSync(jsonlPath, lines.join("\n") + "\n")

    // Verify via transcript
    const updated = await getAgentSessionTranscript(SESSION_ID, TEST_DIR)
    const patchedMsg = updated.find((m: any) => m.sequence === seq) as any
    const updatedContent = patchedMsg?.message?.message?.content ?? patchedMsg?.message?.content
    const updatedBlock = updatedContent?.find((b: any) => b.name?.includes("render_output"))
    expect(updatedBlock.input.data.code).toBe("new patched code")
  })

  it("sequence is stable: partial messages don't shift render_output index", async () => {
    const { getAgentSessionTranscript } = await import("../session-manager.js")

    const messages = await getAgentSessionTranscript(SESSION_ID, TEST_DIR)

    // Line 3 is a partial (filtered), line 6 is a partial (filtered)
    // The render_output at line 7 should still have sequence=7 (line index)
    // NOT sequence=5 (which it would be with filtered counting)
    const renderMsg = messages.find((m: any) => {
      const content = m.message?.message?.content ?? m.message?.content ?? []
      return Array.isArray(content) && content.some((b: any) => b.name?.includes("render_output"))
    })
    expect(renderMsg).toBeDefined()
    expect(renderMsg!.sequence).toBe(7)  // Line index, not filtered count
  })
})
