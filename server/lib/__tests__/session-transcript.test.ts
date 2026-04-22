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

// Build a realistic JSONL with streaming deltas (stop_reason:null), tool
// results, and render_output. The Agent SDK writes each streaming delta as
// its own entry with its own content blocks; only the last delta in a turn
// has stop_reason set.
function buildTestJsonl(): string {
  const lines = [
    // Line 0: queue operation (non-display)
    JSON.stringify({ type: "queue-operation", operation: "enqueue", sessionId: SESSION_ID }),
    // Line 1: queue operation (non-display)
    JSON.stringify({ type: "queue-operation", operation: "dequeue", sessionId: SESSION_ID }),
    // Line 2: user message
    JSON.stringify({ type: "user", message: { content: "Create a plan", role: "user" }, timestamp: "2026-01-01T00:00:00Z" }),
    // Line 3: streaming text delta (stop_reason:null, real content) — should render
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Let me think..." }], stop_reason: null }, timestamp: "2026-01-01T00:00:01Z" }),
    // Line 4: final delta of same turn — should render
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Here is my analysis" }], stop_reason: "tool_use" }, timestamp: "2026-01-01T00:00:02Z" }),
    // Line 5: tool result (non-display)
    JSON.stringify({ type: "tool_result", tool_use_id: "tu1", content: "ok" }),
    // Line 6: streaming preamble text before a tool call — should render
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Now let me render the plan." }], stop_reason: null }, timestamp: "2026-01-01T00:00:03Z" }),
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

  it("getAgentSessionTranscript emits streaming deltas with content and uses line index as sequence", async () => {
    const { getAgentSessionTranscript } = await import("../session-manager.js")

    const messages = await getAgentSessionTranscript(SESSION_ID, TEST_DIR)

    // All assistant entries with real content render — including streaming
    // deltas where stop_reason is null. Each delta has its own content blocks,
    // so dropping them loses text preambles and split tool_use sequences.
    const types = messages.map((m: any) => `${m.type}@seq${m.sequence}`)
    expect(types).toContain("user@seq2")
    expect(types).toContain("assistant@seq3")
    expect(types).toContain("assistant@seq4")
    expect(types).toContain("assistant@seq6")
    expect(types).toContain("assistant@seq7")
    expect(types).toContain("assistant@seq8")

    // Non-display types should be filtered
    expect(messages.every((m: any) => m.type !== "queue-operation")).toBe(true)
    expect(messages.every((m: any) => m.type !== "tool_result")).toBe(true)
  })

  it("getAgentSessionTranscript emits thinking blocks standalone and defers Agent tool_use", async () => {
    const fs = await import("fs")
    const lines = [
      JSON.stringify({ type: "user", message: { content: "Launch an agent", role: "user" }, timestamp: "2026-01-01T00:00:00Z" }),
      // Thinking-only partial — collected, emitted as its own message before next
      JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "Planning the agent invocation" }], stop_reason: null }, timestamp: "2026-01-01T00:00:01Z" }),
      // Agent tool_use partial — collected, prepended to next message with content
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Agent", id: "agent_1", input: { description: "sub" } }], stop_reason: null }, timestamp: "2026-01-01T00:00:02Z" }),
      // Complete turn with text — should receive the prepended Agent tool_use
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Launched." }], stop_reason: "end_turn" }, timestamp: "2026-01-01T00:00:03Z" }),
    ]
    fs.writeFileSync(join(PROJECT_DIR, `${SESSION_ID}.jsonl`), lines.join("\n") + "\n")

    const { getAgentSessionTranscript } = await import("../session-manager.js")
    const messages = await getAgentSessionTranscript(SESSION_ID, TEST_DIR)

    // Thinking is emitted as a standalone assistant message with fractional
    // sequence so it sorts between lines.
    const thinkingMsg = messages.find((m: any) => {
      const blocks = m.message?.message?.content ?? []
      return Array.isArray(blocks) && blocks.some((b: any) => b.type === "thinking")
    }) as any
    expect(thinkingMsg).toBeDefined()

    // The complete text message gets the Agent tool_use prepended.
    const textWithAgent = messages.find((m: any) => {
      const blocks = m.message?.message?.content ?? []
      if (!Array.isArray(blocks)) return false
      return blocks.some((b: any) => b.type === "tool_use" && b.name === "Agent")
        && blocks.some((b: any) => b.type === "text" && b.text === "Launched.")
    })
    expect(textWithAgent).toBeDefined()
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
    const msg = JSON.parse(lines[seq]!)
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

// ---------------------------------------------------------------------------
// patchArtifactCode — locate by tool_use id, patch the right field per tool
// ---------------------------------------------------------------------------

const PATCH_SESSION_ID = "test-patch-456"

function buildPatchJsonl(): string {
  const lines = [
    // Head must include cwd so findAgentSession can locate the session
    JSON.stringify({ type: "summary", summary: "patch test", cwd: TEST_DIR }),
    JSON.stringify({ type: "user", message: { content: "Make stuff", role: "user" }, cwd: TEST_DIR, timestamp: "2026-01-01T00:00:00Z" }),
    // render_output assistant
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tu_render", name: "mcp__render_output__render_output", input: { type: "react", title: "T1", data: { code: "old render" } } }], stop_reason: "tool_use" },
      timestamp: "2026-01-01T00:00:01Z",
    }),
    // create_file assistant
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tu_create", name: "mcp__artifact__create_file", input: { description: "x", path: "/mnt/user-data/outputs/foo.jsx", file_text: "old create" } }], stop_reason: "tool_use" },
      timestamp: "2026-01-01T00:00:02Z",
    }),
    // Write assistant
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tu_write", name: "Write", input: { file_path: "/tmp/foo.jsx", content: "old write" } }], stop_reason: "tool_use" },
      timestamp: "2026-01-01T00:00:03Z",
    }),
    // unrelated tool
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tu_other", name: "Bash", input: { command: "ls" } }], stop_reason: "tool_use" },
      timestamp: "2026-01-01T00:00:04Z",
    }),
  ]
  return lines.join("\n") + "\n"
}

describe("patchArtifactCode by tool_use id", () => {
  beforeEach(() => {
    vi.resetModules()
    mkdirSync(PROJECT_DIR, { recursive: true })
    writeFileSync(join(PROJECT_DIR, `${PATCH_SESSION_ID}.jsonl`), buildPatchJsonl())
  })

  async function readBlock(toolUseId: string) {
    const fs = await import("fs")
    const jsonlPath = join(PROJECT_DIR, `${PATCH_SESSION_ID}.jsonl`)
    const lines = fs.readFileSync(jsonlPath, "utf-8").trim().split("\n")
    for (const line of lines) {
      const msg = JSON.parse(line)
      const content = msg.message?.content ?? msg.content
      if (!Array.isArray(content)) continue
      for (const b of content) if (b.id === toolUseId) return b
    }
    return null
  }

  it("patches render_output input.data.code", async () => {
    const { patchArtifactCode } = await import("../session-manager.js")
    const ok = await patchArtifactCode(PATCH_SESSION_ID, "tu_render", "new render")
    expect(ok).toBe(true)
    const block = await readBlock("tu_render")
    expect(block.input.data.code).toBe("new render")
  })

  it("patches create_file input.file_text", async () => {
    const { patchArtifactCode } = await import("../session-manager.js")
    const ok = await patchArtifactCode(PATCH_SESSION_ID, "tu_create", "new create")
    expect(ok).toBe(true)
    const block = await readBlock("tu_create")
    expect(block.input.file_text).toBe("new create")
  })

  it("patches Write input.content", async () => {
    const { patchArtifactCode } = await import("../session-manager.js")
    const ok = await patchArtifactCode(PATCH_SESSION_ID, "tu_write", "new write")
    expect(ok).toBe(true)
    const block = await readBlock("tu_write")
    expect(block.input.content).toBe("new write")
  })

  it("returns false for unknown tool_use id", async () => {
    const { patchArtifactCode } = await import("../session-manager.js")
    const ok = await patchArtifactCode(PATCH_SESSION_ID, "tu_does_not_exist", "x")
    expect(ok).toBe(false)
  })

  it("returns false for tool_use whose tool name we don't know how to patch", async () => {
    const { patchArtifactCode } = await import("../session-manager.js")
    const ok = await patchArtifactCode(PATCH_SESSION_ID, "tu_other", "x")
    expect(ok).toBe(false)
  })
})
