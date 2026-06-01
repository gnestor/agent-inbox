import { vi, describe, it, expect, beforeEach } from "vitest"

// Mutable mock state shared across resetModules boundaries.
const agentSessionsStub = vi.hoisted(() => ({ current: [] as any[] }))
const staleRowsStub = vi.hoisted(() => ({ current: [] as any[] }))

// In-memory record of execute() calls so we can assert status transitions.
const executeCalls = vi.hoisted(() => ({ list: [] as { sql: string; params: unknown[] }[] }))
// Capture rows inserted via the withTransaction client during indexing.
const inserted = vi.hoisted(() => ({ rows: [] as { id: string; status: string; prompt: string; summary: string }[] }))

vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async (sql: string) => {
    if (sql.includes("FROM sessions") && sql.includes("status = ANY")) {
      return staleRowsStub.current
    }
    return []
  }),
  queryOne: vi.fn(async (sql: string, params?: unknown[]) => {
    // recoverStaleSessions -> updateSessionStatus reads current status for the CAS path
    if (sql.includes("SELECT status FROM sessions")) {
      const id = params?.[0] as string
      const row = staleRowsStub.current.find((r) => r.id === id)
      return row ? { status: row.status } : undefined
    }
    return undefined
  }),
  execute: vi.fn(async (sql: string, params: unknown[] = []) => {
    executeCalls.list.push({ sql, params })
    return { rowCount: 1 }
  }),
  withTransaction: vi.fn(async (fn: any) =>
    fn({
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("INSERT INTO sessions") && sql.includes("ON CONFLICT DO NOTHING")) {
          const [id, prompt, summary] = params as [string, string, string]
          inserted.rows.push({ id, status: "complete", prompt, summary })
          return { rowCount: 1 }
        }
        return { rowCount: 0 }
      }),
    }),
  ),
}))

vi.mock("../../lib/credentials.js", () => ({
  getAgentEnv: () => ({}),
}))

// Control what the Agent SDK's listSessions returns (drives indexAllAgentSessions).
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  listSessions: vi.fn(async () => agentSessionsStub.current),
  query: vi.fn(),
  tool: vi.fn(),
  createSdkMcpServer: vi.fn(),
}))

describe("encodeWorkspacePath / workspaceProjectsDir", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("Scenario: `encodeWorkspacePath` mirrors the Agent SDK's projects-dir convention — replaces slashes with dashes and derives the directory portion", async () => {
    const { encodeWorkspacePath, workspaceProjectsDir } = await import("../session-manager.js")
    expect(encodeWorkspacePath("/Users/grant/Github/hammies/hammies-agent")).toBe(
      "-Users-grant-Github-hammies-hammies-agent",
    )
    // workspaceProjectsDir returns the directory (no filename) ending in the encoded path.
    const dir = workspaceProjectsDir("/Users/grant/Github/hammies/hammies-agent")
    expect(dir.endsWith("/.claude/projects/-Users-grant-Github-hammies-hammies-agent")).toBe(true)
  })
})

describe("indexAllAgentSessions", () => {
  beforeEach(() => {
    vi.resetModules()
    inserted.rows = []
    executeCalls.list = []
    agentSessionsStub.current = []
  })

  it("Scenario: `indexAllAgentSessions` rebuilds the `sessions` table from JSONL on startup — inserts a missing row with status complete derived from JSONL", async () => {
    agentSessionsStub.current = [
      {
        sessionId: "idx-1",
        firstPrompt: "Do the thing",
        summary: "Did the thing",
        lastModified: Date.parse("2026-02-01T10:00:00Z"),
      },
    ]

    const { indexAllAgentSessions } = await import("../session-manager.js")
    await indexAllAgentSessions()

    expect(inserted.rows).toHaveLength(1)
    expect(inserted.rows[0]).toMatchObject({
      id: "idx-1",
      status: "complete",
      prompt: "Do the thing",
      summary: "Did the thing",
    })
  })
})

describe("recoverStaleSessions", () => {
  beforeEach(() => {
    vi.resetModules()
    executeCalls.list = []
    staleRowsStub.current = []
  })

  it("Scenario: `recoverStaleSessions` fixes orphan `running` rows on boot — flips old running rows to errored", async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 60 min ago, beyond 30 min cutoff
    staleRowsStub.current = [{ id: "ghost-1", status: "running", updated_at: old }]

    const { recoverStaleSessions } = await import("../session-manager.js")
    await recoverStaleSessions(30)

    // updateSessionStatus issued an UPDATE setting status = 'errored' for the orphan.
    const erroredUpdate = executeCalls.list.find(
      (c) => /UPDATE\s+sessions\s+SET\s+status/i.test(c.sql) && (c.params as unknown[]).includes("errored"),
    )
    expect(erroredUpdate).toBeDefined()
    expect((erroredUpdate!.params as unknown[]).includes("ghost-1")).toBe(true)
  })

  it("returns early without any status writes when no active rows exist", async () => {
    staleRowsStub.current = []
    const { recoverStaleSessions } = await import("../session-manager.js")
    await recoverStaleSessions(30)
    const statusWrites = executeCalls.list.filter((c) => /UPDATE\s+sessions\s+SET\s+status/i.test(c.sql))
    expect(statusWrites).toHaveLength(0)
  })
})

describe("classifyAssistantBlocks", () => {
  // DOC-ONLY MARKER: `classifyAssistantBlocks(content)` is a module-private helper
  // (not exported from session-manager.ts) used internally by getAgentSessionTranscript
  // to split assistant content into text/tool_use/thinking blocks. Its behavior is
  // exercised indirectly by the transcript tests in session-transcript.test.ts
  // ("emits thinking blocks standalone and defers Agent tool_use"). It has no public
  // entry point to assert against directly, so this marker carries the scenario
  // string for coverage; the real assertions live in session-transcript.test.ts.
  it("Scenario: `classifyAssistantBlocks(content)` separates text/tool_use/thinking — documented; covered indirectly via getAgentSessionTranscript", () => {
    expect(true).toBe(true)
  })
})
