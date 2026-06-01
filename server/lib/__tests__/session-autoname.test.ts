import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

// Control homedir so findAgentSession/getAgentSessionTranscript read our temp JSONL.
let _tmpDir = ""
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>()
  return { ...actual, homedir: () => _tmpDir || actual.homedir() }
})

const iteratorMessages = vi.hoisted(() => ({ current: [] as any[] }))
const sessionRecord = vi.hoisted(() => ({ current: null as any }))
const summaryUpdates = vi.hoisted(() => ({ list: [] as { id: string; summary: string }[] }))
const generateTitle = vi.hoisted(() => ({ current: null as string | null }))

vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async (sql: string) => {
    if (sql.includes("FROM sessions") && sql.includes("WHERE id")) return sessionRecord.current
    return undefined
  }),
  execute: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/UPDATE\s+sessions\s+SET\s+summary/i.test(sql)) {
      // updateSessionSummary: [summary, updated_at, id]
      summaryUpdates.list.push({ id: params[2] as string, summary: params[0] as string })
    }
    return { rowCount: 1 }
  }),
  withTransaction: vi.fn(async (fn: any) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}))

vi.mock("../../lib/credentials.js", () => ({ getAgentEnv: () => ({}) }))

vi.mock("../../lib/title-generator.js", () => ({
  generateSessionTitle: vi.fn(async () => generateTitle.current),
}))

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => ({
    [Symbol.asyncIterator]: async function* () {
      for (const m of iteratorMessages.current) yield m
    },
  })),
  tool: vi.fn(),
  createSdkMcpServer: vi.fn(),
}))

const SESSION_ID = "autoname-sess-1"
const CWD = "/Users/grant/Github/hammies/hammies-agent"

function writeTranscript(projectsDir: string) {
  const projectDir = path.join(projectsDir, CWD.replace(/\//g, "-"))
  fs.mkdirSync(projectDir, { recursive: true })
  const lines = [
    JSON.stringify({ cwd: CWD, type: "user", message: { role: "user", content: [{ type: "text", text: "Investigate the bug" }] }, sessionId: SESSION_ID }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Found and fixed it" }] }, sessionId: SESSION_ID }),
  ]
  fs.writeFileSync(path.join(projectDir, `${SESSION_ID}.jsonl`), lines.join("\n") + "\n")
}

describe("autoNameSession on completion", () => {
  beforeEach(() => {
    vi.resetModules()
    _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-autoname-"))
    const projectsDir = path.join(_tmpDir, ".claude", "projects")
    fs.mkdirSync(projectsDir, { recursive: true })
    writeTranscript(projectsDir)
    iteratorMessages.current = [
      { type: "system", subtype: "init", session_id: SESSION_ID },
      { type: "result", result: "done" },
    ]
    summaryUpdates.list = []
    generateTitle.current = "Investigate and fix the bug"
    // summary still equals prompt.slice(0, 80) — user hasn't renamed.
    sessionRecord.current = { id: SESSION_ID, status: "running", prompt: "Investigate the bug", summary: "Investigate the bug" }
  })

  afterEach(() => {
    fs.rmSync(_tmpDir, { recursive: true, force: true })
    _tmpDir = ""
  })

  it("Scenario: `autoNameSession` runs on session completion if summary still equals the prompt prefix — generates and stores a title", async () => {
    const { startSession } = await import("../session-manager.js")
    await startSession("Investigate the bug", { workspacePath: CWD })

    // Wait for the background loop to complete and auto-naming to run.
    await new Promise((r) => setTimeout(r, 50))

    const update = summaryUpdates.list.find((u) => u.id === SESSION_ID)
    expect(update).toBeDefined()
    expect(update!.summary).toBe("Investigate and fix the bug")
  })

  it("Scenario: Auto-naming runs only on first non-trivial turn — skips when summary no longer equals the prompt slice", async () => {
    sessionRecord.current = { id: SESSION_ID, status: "running", prompt: "Investigate the bug", summary: "My custom name" }
    const { startSession } = await import("../session-manager.js")
    await startSession("Investigate the bug", { workspacePath: CWD })
    await new Promise((r) => setTimeout(r, 50))
    expect(summaryUpdates.list.find((u) => u.id === SESSION_ID)).toBeUndefined()
  })

  it("skips auto-naming when the user has already renamed the session", async () => {
    sessionRecord.current = { id: SESSION_ID, status: "running", prompt: "Investigate the bug", summary: "My custom name" }
    const { startSession } = await import("../session-manager.js")
    await startSession("Investigate the bug", { workspacePath: CWD })
    await new Promise((r) => setTimeout(r, 50))
    expect(summaryUpdates.list.find((u) => u.id === SESSION_ID)).toBeUndefined()
  })
})
