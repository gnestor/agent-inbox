import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

// We need to control homedir() so tests use a temp directory.
// ESM native modules can't be spied on directly; use vi.mock instead.
let _tmpDir = ""
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>()
  return {
    ...actual,
    homedir: () => _tmpDir || actual.homedir(),
  }
})

// Mock DB and credentials (required by the module but not exercised here)
vi.mock("../../db/schema.js", () => ({
  getDb: () => ({
    prepare: () => ({
      get: vi.fn(),
      run: vi.fn(),
      all: vi.fn(() => []),
    }),
  }),
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

  it("finds a session whose search term appears beyond the 200-char firstPrompt truncation", async () => {
    const sessionId = "1c0377de-da02-4397-9eb3-02f09817ff80"
    const cwd = "/Users/grant/Github/hammies/hammies-agent"
    const projectDir = path.join(projectsDir, cwd.replace(/\//g, "-"))
    fs.mkdirSync(projectDir, { recursive: true })

    // Build a prompt where "Hammies End to End Supply Chain 2024" appears after position 200
    const longPrefix =
      "I want to get realistic quotes from 2-3 other 3PLs so that I can present them to DM and negotiate better rates. I tried this once before but the quote that I received was too difficult to compare with DM's pricing (see the spreadsheet for reference), so I'd like to format DM's pricing and quotes from other vendors in a spreadsheet with columns for billing line item and columns for vendors.\n\nI have a couple email threads going with different 3PLs:\n"
    const promptText = longPrefix + '- Flexport: "Hammies End to End Supply Chain 2024"'

    // Confirm the search term is beyond 200 chars
    expect(longPrefix.length).toBeGreaterThan(200)
    expect(promptText.slice(0, 200)).not.toContain("Hammies End to End Supply Chain 2024")
    expect(promptText).toContain("Hammies End to End Supply Chain 2024")

    const jsonlContent = [makeUserLine(promptText, cwd), makeResultLine("Done")].join("\n") + "\n"

    fs.writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), jsonlContent)

    const { searchAgentSessions } = await import("../session-manager.js")
    const results = await searchAgentSessions("Hammies End to End Supply Chain 2024")

    expect(results).toHaveLength(1)
    expect(results[0].sessionId).toBe(sessionId)
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
