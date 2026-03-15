import { vi, describe, it, expect, beforeEach } from "vitest"

// ─── DB mock ──────────────────────────────────────────────────────────────────
//
// Tracks the last SQL and args passed to prepare().run() / prepare().get() so
// tests can assert on what was actually written without a real SQLite DB.
//
// For INSERT OR IGNORE we also populate a simple in-memory store so that
// getSessionRecord() and listSessionRecords() can return the inserted row.

type Row = Record<string, unknown>
let store: Map<string, Row> = new Map()

// Last captured calls — reset in beforeEach
let lastRunSql = ""
let lastRunArgs: unknown[] = []

function makeDb() {
  return {
    prepare(sql: string) {
      return {
        run(...args: unknown[]) {
          lastRunSql = sql
          lastRunArgs = args

          if (/INSERT\s+OR\s+IGNORE\s+INTO\s+sessions/i.test(sql)) {
            // importAgentSession SQL:
            //   INSERT OR IGNORE INTO sessions
            //     (id, status, prompt, summary, started_at, updated_at, completed_at, trigger_source)
            //   VALUES (?, 'complete', ?, ?, ?, ?, ?, 'manual')
            // args: [id, firstPrompt, summary, ts, ts, ts]
            const [id, prompt, summary, started_at, updated_at, completed_at] = args as string[]
            if (!store.has(id)) {
              store.set(id, {
                id,
                status: "complete",
                prompt,
                summary,
                started_at,
                updated_at,
                completed_at,
                trigger_source: "manual",
              })
            }
          }

          if (/UPDATE\s+sessions\s+SET\s+summary/i.test(sql)) {
            // updateSessionSummary SQL:
            //   UPDATE sessions SET summary = ?, updated_at = ? WHERE id = ?
            // args: [summary, updated_at, id]
            const [summary, updated_at, id] = args as string[]
            if (store.has(id)) {
              store.set(id, { ...store.get(id)!, summary, updated_at })
            }
          }
        },

        get(id: unknown) {
          if (/SELECT\s+\*\s+FROM\s+sessions/i.test(sql)) {
            return store.get(id as string) ?? undefined
          }
          return undefined
        },

        all(..._args: unknown[]) {
          if (/SELECT/i.test(sql)) return [...store.values()]
          return []
        },
      }
    },
  }
}

vi.mock("../../db/schema.js", () => ({
  getDb: () => makeDb(),
}))

vi.mock("../../lib/credentials.js", () => ({
  getAgentEnv: () => ({}),
}))

// ─── importAgentSession tests ─────────────────────────────────────────────────

describe("importAgentSession", () => {
  beforeEach(() => {
    vi.resetModules()
    store = new Map()
    lastRunSql = ""
    lastRunArgs = []
  })

  it("inserts a row with status='complete'", async () => {
    const { importAgentSession } = await import("../session-manager.js")
    importAgentSession("sess-001", {
      firstPrompt: "Draft an email",
      summary: "Drafted the email",
      lastModified: new Date("2026-01-15T10:00:00Z").getTime(),
    })
    const row = store.get("sess-001")
    expect(row).toBeDefined()
    expect(row!.status).toBe("complete")
  })

  it("inserts with correct id and prompt", async () => {
    const { importAgentSession } = await import("../session-manager.js")
    importAgentSession("sess-002", {
      firstPrompt: "Analyze the sales data",
      summary: "Completed analysis",
      lastModified: new Date("2026-02-01T08:00:00Z").getTime(),
    })
    const row = store.get("sess-002")
    expect(row!.id).toBe("sess-002")
    expect(row!.prompt).toBe("Analyze the sales data")
    expect(row!.summary).toBe("Completed analysis")
  })

  it("derives timestamps from lastModified", async () => {
    const { importAgentSession } = await import("../session-manager.js")
    const lastModified = new Date("2026-03-10T12:30:00Z").getTime()
    importAgentSession("sess-003", {
      firstPrompt: "Write a report",
      summary: null,
      lastModified,
    })
    const expected = new Date(lastModified).toISOString()
    const row = store.get("sess-003")
    expect(row!.started_at).toBe(expected)
    expect(row!.updated_at).toBe(expected)
    expect(row!.completed_at).toBe(expected)
  })

  it("sets trigger_source to 'manual'", async () => {
    const { importAgentSession } = await import("../session-manager.js")
    importAgentSession("sess-004", {
      firstPrompt: "Test prompt",
      summary: null,
      lastModified: Date.now(),
    })
    const row = store.get("sess-004")
    expect(row!.trigger_source).toBe("manual")
  })

  it("falls back to firstPrompt when summary is null", async () => {
    const { importAgentSession } = await import("../session-manager.js")
    importAgentSession("sess-005", {
      firstPrompt: "Do the thing",
      summary: null,
      lastModified: Date.now(),
    })
    const row = store.get("sess-005")
    expect(row!.summary).toBe("Do the thing")
  })

  it("truncates summary to 200 chars", async () => {
    const { importAgentSession } = await import("../session-manager.js")
    const longSummary = "A".repeat(300)
    importAgentSession("sess-006", {
      firstPrompt: "Short",
      summary: longSummary,
      lastModified: Date.now(),
    })
    const row = store.get("sess-006")
    expect((row!.summary as string).length).toBeLessThanOrEqual(200)
  })

  it("INSERT OR IGNORE does not overwrite an existing row", async () => {
    const { importAgentSession } = await import("../session-manager.js")

    // Pre-populate with a renamed record
    store.set("sess-007", {
      id: "sess-007",
      status: "complete",
      prompt: "Original prompt",
      summary: "Custom renamed summary",
      started_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:00:00Z",
      trigger_source: "manual",
    })

    // Second import attempt — should be ignored
    importAgentSession("sess-007", {
      firstPrompt: "New prompt",
      summary: "New summary",
      lastModified: Date.now(),
    })

    const row = store.get("sess-007")
    expect(row!.prompt).toBe("Original prompt")
    expect(row!.summary).toBe("Custom renamed summary")
  })

  it("handles null firstPrompt gracefully (stores empty string for prompt)", async () => {
    const { importAgentSession } = await import("../session-manager.js")
    importAgentSession("sess-008", {
      firstPrompt: null,
      summary: null,
      lastModified: Date.now(),
    })
    const row = store.get("sess-008")
    expect(row).toBeDefined()
    expect(row!.prompt).toBe("")
  })
})

// ─── updateSessionSummary tests ───────────────────────────────────────────────

describe("updateSessionSummary", () => {
  beforeEach(() => {
    vi.resetModules()
    store = new Map()
    lastRunSql = ""
    lastRunArgs = []
  })

  it("updates the summary column for the given session", async () => {
    store.set("sess-A", {
      id: "sess-A",
      status: "complete",
      prompt: "Original",
      summary: "old summary",
      started_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    })
    const { updateSessionSummary } = await import("../session-manager.js")
    updateSessionSummary("sess-A", "new summary")
    const row = store.get("sess-A")
    expect(row!.summary).toBe("new summary")
  })

  it("updates updated_at to a time no earlier than just before the call", async () => {
    store.set("sess-B", {
      id: "sess-B",
      status: "complete",
      prompt: "Original",
      summary: "old",
      started_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    })
    const before = new Date().toISOString()
    const { updateSessionSummary } = await import("../session-manager.js")
    updateSessionSummary("sess-B", "fresh summary")
    const row = store.get("sess-B")
    const updatedAt = row!.updated_at as string
    expect(updatedAt >= before).toBe(true)
  })

  it("SQL includes both summary and updated_at SET clauses", async () => {
    store.set("sess-C", {
      id: "sess-C",
      status: "complete",
      prompt: "p",
      summary: "old",
      started_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    })
    const { updateSessionSummary } = await import("../session-manager.js")
    updateSessionSummary("sess-C", "renamed")
    expect(lastRunSql).toMatch(/summary/)
    expect(lastRunSql).toMatch(/updated_at/)
  })
})

// ─── Dedup / merge logic tests ────────────────────────────────────────────────

describe("dedup: imported session should not appear twice in merged list", () => {
  beforeEach(() => {
    vi.resetModules()
    store = new Map()
  })

  /**
   * Verify that after importAgentSession, listSessionRecords() returns the row
   * so that dbIds contains the session ID and the JSONL path is filtered out.
   */
  it("listSessionRecords returns the imported session, so dbIds prevents JSONL duplicate", async () => {
    const SESSION_ID = "abc-123"
    const currentProject = "hammies-agent"

    store.set(SESSION_ID, {
      id: SESSION_ID,
      status: "complete",
      prompt: "Do something",
      summary: "Did something",
      started_at: "2026-02-01T10:00:00Z",
      updated_at: "2026-02-01T10:00:00Z",
      completed_at: "2026-02-01T10:00:00Z",
      trigger_source: "manual",
      linked_email_id: null,
      linked_email_thread_id: null,
      linked_task_id: null,
      metadata: null,
      linked_email_subject: null,
      linked_task_title: null,
    })

    const { listSessionRecords } = await import("../session-manager.js")
    const dbSessions = listSessionRecords()

    // Confirm the imported session is returned
    expect(dbSessions.some((s) => s.id === SESSION_ID)).toBe(true)

    // Build dbIds exactly as routes/sessions.ts does
    const dbIds = new Set(dbSessions.map((s) => s.id as string))
    expect(dbIds.has(SESSION_ID)).toBe(true)

    // Simulate the agent session list containing the same session
    const agentSessions = [
      {
        sessionId: SESSION_ID,
        project: currentProject,
        firstPrompt: "Do something",
        summary: "Did something",
        lastModified: new Date("2026-02-01T10:00:00Z").getTime(),
        cwd: `/Users/grant/Github/hammies/${currentProject}`,
      },
    ]

    // Apply the dedup filter from routes/sessions.ts line 78
    const filtered = agentSessions.filter((s) => !dbIds.has(s.sessionId))

    expect(filtered).toHaveLength(0)
  })

  it("agent session appears exactly once in merged list (DB version wins)", async () => {
    const SESSION_ID = "xyz-999"
    const currentProject = "hammies-agent"

    store.set(SESSION_ID, {
      id: SESSION_ID,
      status: "complete",
      prompt: "Rename me",
      summary: "Renamed summary",
      started_at: "2026-03-01T09:00:00Z",
      updated_at: "2026-03-01T09:30:00Z",
      completed_at: "2026-03-01T09:00:00Z",
      trigger_source: "manual",
      linked_email_id: null,
      linked_email_thread_id: null,
      linked_task_id: null,
      metadata: null,
      linked_email_subject: null,
      linked_task_title: null,
    })

    const { listSessionRecords } = await import("../session-manager.js")
    const dbSessions = listSessionRecords()
    const dbIds = new Set(dbSessions.map((s) => s.id as string))

    const dbMapped = dbSessions.map((s) => ({
      id: s.id as string,
      status: s.status as string,
      summary: s.summary as string,
      project: currentProject,
    }))

    const agentSessions = [
      {
        sessionId: SESSION_ID,
        project: currentProject,
        firstPrompt: "Rename me",
        summary: "Old JSONL summary",
        lastModified: new Date("2026-03-01T09:00:00Z").getTime(),
        cwd: `/Users/grant/Github/hammies/${currentProject}`,
      },
    ]

    const agentMapped = agentSessions
      .filter((s) => [currentProject].includes(s.project))
      .filter((s) => !dbIds.has(s.sessionId))
      .map((s) => ({
        id: s.sessionId,
        status: "complete" as const,
        summary: s.summary,
        project: s.project,
      }))

    // Merge + second-pass dedup (mirrors routes/sessions.ts lines 98-103)
    const merged = [...dbMapped, ...agentMapped]
    const seenIds = new Set<string>()
    const deduped = merged.filter((s) => {
      if (seenIds.has(s.id)) return false
      seenIds.add(s.id)
      return true
    })

    const matches = deduped.filter((s) => s.id === SESSION_ID)
    expect(matches).toHaveLength(1)
    // DB version (renamed summary) should win
    expect(matches[0].summary).toBe("Renamed summary")
  })

  it("JSONL-only session (not in DB) still appears in merged list", async () => {
    const SESSION_ID = "new-jsonl-only"
    const currentProject = "hammies-agent"

    // store is empty — session not in DB
    const { listSessionRecords } = await import("../session-manager.js")
    const dbSessions = listSessionRecords()
    const dbIds = new Set(dbSessions.map((s) => s.id as string))
    expect(dbIds.has(SESSION_ID)).toBe(false)

    const agentSessions = [
      {
        sessionId: SESSION_ID,
        project: currentProject,
        firstPrompt: "I am only a JSONL file",
        summary: null,
        lastModified: Date.now(),
        cwd: `/Users/grant/Github/hammies/${currentProject}`,
      },
    ]

    const agentMapped = agentSessions
      .filter((s) => [currentProject].includes(s.project))
      .filter((s) => !dbIds.has(s.sessionId))
      .map((s) => ({
        id: s.sessionId,
        status: "complete" as const,
        summary: s.summary,
        project: s.project,
      }))

    expect(agentMapped).toHaveLength(1)
    expect(agentMapped[0].id).toBe(SESSION_ID)
  })

  it("full rename flow: import then update summary, getSessionRecord returns new summary", async () => {
    const SESSION_ID = "rename-flow"

    const { importAgentSession, updateSessionSummary, getSessionRecord } = await import(
      "../session-manager.js"
    )

    // Step 1: import
    importAgentSession(SESSION_ID, {
      firstPrompt: "Original agent prompt",
      summary: "Original agent summary",
      lastModified: new Date("2026-02-10T10:00:00Z").getTime(),
    })

    // Step 2: rename
    updateSessionSummary(SESSION_ID, "My custom session name")

    // Step 3: verify
    const record = getSessionRecord(SESSION_ID)
    expect(record).toBeDefined()
    expect(record!.summary).toBe("My custom session name")
    expect(record!.status).toBe("complete")
  })
})
