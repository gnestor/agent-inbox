import { describe, it, expect, vi, beforeEach } from "vitest"
import Database from "better-sqlite3"
import { Hono } from "hono"

process.env.VAULT_SECRET = "aa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"

const dbHolder: { db: Database.Database | null } = { db: null }

vi.mock("../../db/schema.js", () => ({
  getDb: () => dbHolder.db!,
}))

// Mock credentials (required by session-manager)
vi.mock("../credentials.js", () => ({
  getAgentEnv: () => ({}),
}))

// Control what findAgentSession returns
const mockFindAgentSession = vi.fn()
const mockGetAgentSessionTranscript = vi.fn()

vi.mock("../session-manager.js", async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>
  return {
    ...actual,
    findAgentSession: (...args: unknown[]) => mockFindAgentSession(...args),
    getAgentSessionTranscript: (...args: unknown[]) => mockGetAgentSessionTranscript(...args),
    getWorkspacePath: () => "/test/workspace",
    projectLabel: () => "test-workspace",
    getWorkspaceName: () => "test-workspace",
  }
})

const { sessionRoutes } = await import("../../routes/sessions.js")
const {
  archiveSession,
  updateSessionStatus,
  getSessionRecord,
} = await import("../session-manager.js")

function createSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'running',
      prompt TEXT,
      summary TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      message_count INTEGER DEFAULT 0,
      linked_email_id TEXT,
      linked_email_thread_id TEXT,
      linked_task_id TEXT,
      trigger_source TEXT DEFAULT 'manual',
      metadata TEXT,
      linked_email_subject TEXT,
      linked_task_title TEXT,
      linked_source_id TEXT,
      linked_source_type TEXT
    );
    CREATE TABLE IF NOT EXISTS session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
}

function insertSession(
  db: Database.Database,
  id: string,
  status: string = "complete",
) {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO sessions (id, status, prompt, summary, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, status, "Test prompt", "Test summary", now, now)
}

function createTestApp() {
  const app = new Hono()
  app.route("/api/sessions", sessionRoutes)
  return app
}

describe("archiveSession", () => {
  beforeEach(() => {
    dbHolder.db = new Database(":memory:")
    createSchema(dbHolder.db)
    mockFindAgentSession.mockReset()
    mockGetAgentSessionTranscript.mockReset()
  })

  it("returns false for unknown session", () => {
    const result = archiveSession("nonexistent-id")
    expect(result).toBe(false)
  })

  it("sets status to 'archived' for a non-running session", () => {
    const db = dbHolder.db!
    insertSession(db, "sess-complete", "complete")

    const result = archiveSession("sess-complete")
    expect(result).toBe(true)

    const row = getSessionRecord("sess-complete")
    expect(row).toBeDefined()
    expect(row!.status).toBe("archived")
  })

  it("sets status to 'archived' for a running session and cleans up running state", () => {
    const db = dbHolder.db!
    insertSession(db, "sess-running", "running")

    // archiveSession should handle a non-running session gracefully
    // (no abort controller in map, but should still archive)
    const result = archiveSession("sess-running")
    expect(result).toBe(true)

    const row = getSessionRecord("sess-running")
    expect(row!.status).toBe("archived")
  })
})

describe("updateSessionStatus race condition guard", () => {
  beforeEach(() => {
    dbHolder.db = new Database(":memory:")
    createSchema(dbHolder.db)
  })

  it("does not overwrite 'archived' status when 'complete' is applied", () => {
    const db = dbHolder.db!
    insertSession(db, "sess-archived", "archived")

    // Try to set to 'complete' -- should be a no-op because current status is 'archived'
    updateSessionStatus("sess-archived", "complete")

    const row = getSessionRecord("sess-archived")
    expect(row!.status).toBe("archived")
  })

  it("does not overwrite 'archived' status when 'errored' is applied", () => {
    const db = dbHolder.db!
    insertSession(db, "sess-archived2", "archived")

    // Try to set to 'errored' -- should be a no-op
    updateSessionStatus("sess-archived2", "errored", "some error")

    const row = getSessionRecord("sess-archived2")
    expect(row!.status).toBe("archived")
  })

  it("allows setting 'complete' when current status is 'running'", () => {
    const db = dbHolder.db!
    insertSession(db, "sess-running", "running")

    updateSessionStatus("sess-running", "complete")

    const row = getSessionRecord("sess-running")
    expect(row!.status).toBe("complete")
  })

  it("allows setting other statuses when current status is 'archived'", () => {
    const db = dbHolder.db!
    insertSession(db, "sess-archived3", "archived")

    // Non-terminal statuses (e.g., 'running') should still be settable
    // (edge case: only 'complete' and 'errored' are guarded)
    updateSessionStatus("sess-archived3", "running")

    const row = getSessionRecord("sess-archived3")
    expect(row!.status).toBe("running")
  })
})

describe("POST /sessions/:id/archive", () => {
  beforeEach(() => {
    dbHolder.db = new Database(":memory:")
    createSchema(dbHolder.db)
    mockFindAgentSession.mockReset()
    mockGetAgentSessionTranscript.mockReset()
  })

  it("returns { ok: true } and archives a known session", async () => {
    const db = dbHolder.db!
    insertSession(db, "sess-to-archive", "complete")

    const app = createTestApp()
    const res = await app.request("http://localhost/api/sessions/sess-to-archive/archive", {
      method: "POST",
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)

    const row = getSessionRecord("sess-to-archive")
    expect(row!.status).toBe("archived")
  })

  it("returns { ok: false } for unknown session", async () => {
    const app = createTestApp()
    const res = await app.request("http://localhost/api/sessions/nonexistent/archive", {
      method: "POST",
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(false)
  })
})
