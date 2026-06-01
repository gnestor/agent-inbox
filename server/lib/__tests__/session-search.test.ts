import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

// We need to control homedir() so tests use a temp directory.
let _tmpDir = ""
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>()
  return {
    ...actual,
    homedir: () => _tmpDir || actual.homedir(),
  }
})

// Mock DB and credentials (required by the module but not exercised here)
vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => undefined),
  execute: vi.fn(async () => ({ rowCount: 0 })),
  withTransaction: vi.fn(async (fn: any) => fn({
    query: vi.fn(async () => ({ rows: [] })),
  })),
}))

vi.mock("../../lib/credentials.js", () => ({
  getAgentEnv: () => ({}),
}))

// Helper: build a JSONL line for a user message
function makeUserLine(text: string, cwd = "/Users/grant/Github/hammies/hammies-agent"): string {
  return JSON.stringify({
    cwd,
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
    sessionId: "test-session",
    timestamp: "2026-01-01T00:00:00.000Z",
  })
}

function makeResultLine(result: string): string {
  return JSON.stringify({
    type: "result",
    result,
    timestamp: "2026-01-01T01:00:00.000Z",
  })
}

describe("searchAgentSessions", () => {
  let projectsDir: string

  beforeEach(() => {
    vi.resetModules()
    _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-test-"))
    projectsDir = path.join(_tmpDir, ".claude", "projects")
    fs.mkdirSync(projectsDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(_tmpDir, { recursive: true, force: true })
    _tmpDir = ""
  })

  it("Scenario: `searchAgentSessions(q, wsPath?)` reads head/tail of each JSONL — finds a session whose search term appears beyond the 200-char firstPrompt truncation", async () => {
    const sessionId = "1c0377de-da02-4397-9eb3-02f09817ff80"
    const cwd = "/Users/grant/Github/hammies/hammies-agent"
    const projectDir = path.join(projectsDir, cwd.replace(/\//g, "-"))
    fs.mkdirSync(projectDir, { recursive: true })

    const longPrefix =
      "I want to get realistic quotes from 2-3 other 3PLs so that I can present them to DM and negotiate better rates. I tried this once before but the quote that I received was too difficult to compare with DM's pricing (see the spreadsheet for reference), so I'd like to format DM's pricing and quotes from other vendors in a spreadsheet with columns for billing line item and columns for vendors.\n\nI have a couple email threads going with different 3PLs:\n"
    const promptText = longPrefix + '- Flexport: "Hammies End to End Supply Chain 2024"'

    expect(longPrefix.length).toBeGreaterThan(200)
    expect(promptText.slice(0, 200)).not.toContain("Hammies End to End Supply Chain 2024")
    expect(promptText).toContain("Hammies End to End Supply Chain 2024")

    const jsonlContent = [makeUserLine(promptText, cwd), makeResultLine("Done")].join("\n") + "\n"

    fs.writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), jsonlContent)

    const { searchAgentSessions } = await import("../session-manager.js")
    const results = await searchAgentSessions("Hammies End to End Supply Chain 2024")

    expect(results).toHaveLength(1)
    expect(results[0]!.sessionId).toBe(sessionId)
  })

  it("does not return sessions that don't contain the search term", async () => {
    const cwd = "/Users/grant/Github/hammies/hammies-agent"
    const projectDir = path.join(projectsDir, cwd.replace(/\//g, "-"))
    fs.mkdirSync(projectDir, { recursive: true })

    const jsonlContent = makeUserLine("I want to buy some widgets and stuff", cwd) + "\n"
    fs.writeFileSync(path.join(projectDir, "unrelated-session.jsonl"), jsonlContent)

    const { searchAgentSessions } = await import("../session-manager.js")
    const results = await searchAgentSessions("Hammies End to End Supply Chain 2024")

    expect(results).toHaveLength(0)
  })

  it("is case-insensitive", async () => {
    const cwd = "/Users/grant/Github/hammies/hammies-agent"
    const projectDir = path.join(projectsDir, cwd.replace(/\//g, "-"))
    fs.mkdirSync(projectDir, { recursive: true })

    const jsonlContent = makeUserLine("hammies end to end supply chain 2024", cwd) + "\n"
    fs.writeFileSync(path.join(projectDir, "case-session.jsonl"), jsonlContent)

    const { searchAgentSessions } = await import("../session-manager.js")
    const results = await searchAgentSessions("Hammies End to End Supply Chain 2024")

    expect(results).toHaveLength(1)
  })

  it("finds matches in the session summary (tail of file)", async () => {
    const cwd = "/Users/grant/Github/hammies/hammies-agent"
    const projectDir = path.join(projectsDir, cwd.replace(/\//g, "-"))
    fs.mkdirSync(projectDir, { recursive: true })

    const jsonlContent =
      [makeUserLine("Unrelated prompt", cwd), makeResultLine("Completed Hammies End to End Supply Chain 2024 analysis")].join("\n") + "\n"
    fs.writeFileSync(path.join(projectDir, "summary-session.jsonl"), jsonlContent)

    const { searchAgentSessions } = await import("../session-manager.js")
    const results = await searchAgentSessions("Hammies End to End Supply Chain 2024")

    expect(results).toHaveLength(1)
  })
})

describe("findAgentSession", () => {
  let projectsDir: string

  beforeEach(() => {
    vi.resetModules()
    _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-find-"))
    projectsDir = path.join(_tmpDir, ".claude", "projects")
    fs.mkdirSync(projectsDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(_tmpDir, { recursive: true, force: true })
    _tmpDir = ""
  })

  it("Scenario: `findAgentSession(id)` searches every registered workspace path — finds the JSONL in a non-primary workspace dir and returns its cwd", async () => {
    // A session living in an arbitrary workspace's projects dir (not the default).
    const cwd = "/Users/grant/Github/hammies/other-workspace"
    const projectDir = path.join(projectsDir, cwd.replace(/\//g, "-"))
    fs.mkdirSync(projectDir, { recursive: true })

    const sessionId = "find-me-1234"
    const jsonlContent =
      [makeUserLine("Hello from another workspace", cwd), makeResultLine("Done")].join("\n") + "\n"
    fs.writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), jsonlContent)

    const { findAgentSession } = await import("../session-manager.js")
    const found = await findAgentSession(sessionId)

    expect(found).not.toBeNull()
    expect(found!.sessionId).toBe(sessionId)
    // The result carries cwd so subsequent helpers know which projects-dir to read.
    expect(found!.cwd).toBe(cwd)
  })

  it("returns null when no registered workspace path holds the session", async () => {
    const { findAgentSession } = await import("../session-manager.js")
    const found = await findAgentSession("nonexistent-session-id")
    expect(found).toBeNull()
  })
})

describe("watchProjectsDir", () => {
  const CWD = "/Users/grant/Github/hammies/watched-ws"
  let watchDir: string

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-watch-"))
    // workspaceProjectsDir() = homedir()/.claude/projects/<encoded CWD>
    watchDir = path.join(_tmpDir, ".claude", "projects", CWD.replace(/\//g, "-"))
    fs.mkdirSync(watchDir, { recursive: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(_tmpDir, { recursive: true, force: true })
    _tmpDir = ""
  })

  it("Scenario: `watchProjectsDir` updates the index live — imports an existing JSONL that grows after the initial scan", async () => {
    const mod = await import("../session-manager.js")
    mod.setWorkspacePath(CWD)

    // Seed one file so the initial scan records its mtime. The watcher only
    // imports files whose mtime advances after the first scan (existing files
    // that grow), so we mutate this file rather than creating a new one.
    const sessId = "live-session-1"
    const filePath = path.join(watchDir, `${sessId}.jsonl`)
    fs.writeFileSync(filePath, makeUserLine("Initial prompt", CWD) + "\n")

    await mod.watchProjectsDir() // runs initial poll(), then schedules a 5s interval

    // The session file grows (agent appended a result) — force a newer mtime so
    // the next poll detects the change deterministically.
    fs.appendFileSync(filePath, makeResultLine("Completed the work") + "\n")
    const future = new Date(Date.now() + 10_000)
    fs.utimesSync(filePath, future, future)

    // Advance past the 5s poll interval and let the async import settle.
    await vi.advanceTimersByTimeAsync(5_001)

    // importAgentSession issues an INSERT ... ON CONFLICT DO NOTHING for the id.
    const { execute } = await import("../../db/pool.js")
    const insertCall = (execute as any).mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        c[0].includes("INSERT INTO sessions") &&
        Array.isArray(c[1]) &&
        (c[1] as unknown[])[0] === sessId,
    )
    expect(insertCall).toBeDefined()
  })
})
