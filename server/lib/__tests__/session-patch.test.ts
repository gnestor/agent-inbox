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

// Control what findAgentSession and getAgentSessionTranscript return
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
  }
})

const { sessionRoutes } = await import("../../routes/sessions.js")
const { importAgentSession, getSessionRecord, updateSessionSummary } = await import(
  "../session-manager.js"
)

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
      linked_email_id TEXT,
      linked_email_thread_id TEXT,
      linked_task_id TEXT,
      trigger_source TEXT DEFAULT 'manual',
      metadata TEXT,
      linked_email_subject TEXT,
      linked_task_title TEXT
    );
    CREATE TABLE IF NOT EXISTS session_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
}

function createTestApp() {
  const app = new Hono()
  app.route("/api/sessions", sessionRoutes)
  return app
}

describe("PATCH /sessions/:id", () => {
  beforeEach(() => {
    dbHolder.db = new Database(":memory:")
    createSchema(dbHolder.db)
    mockFindAgentSession.mockReset()
    mockGetAgentSessionTranscript.mockReset()
  })

  it("returns 200 and updates summary for a DB session", async () => {
    // Insert a session directly into DB
    const db = dbHolder.db!
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO sessions (id, status, prompt, summary, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("sess-db-1", "complete", "Original prompt", "Old summary", now, now)

    const app = createTestApp()
    const res = await app.request("http://localhost/api/sessions/sess-db-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "New renamed summary" }),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)

    // Verify DB was updated
    const row = getSessionRecord("sess-db-1")
    expect(row).toBeDefined()
    expect(row!.summary).toBe("New renamed summary")
  })

  it("returns 400 when summary is not a string", async () => {
    const app = createTestApp()
    const res = await app.request("http://localhost/api/sessions/sess-any", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: 123 }),
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/summary must be a string/)
  })

  it("returns 400 when summary is null", async () => {
    const app = createTestApp()
    const res = await app.request("http://localhost/api/sessions/sess-any", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: null }),
    })

    expect(res.status).toBe(400)
  })

  it("imports agent-only session then updates summary", async () => {
    // Session not in DB, but findAgentSession returns it
    mockFindAgentSession.mockResolvedValue({
      sessionId: "sess-agent-1",
      project: "test-workspace",
      firstPrompt: "Agent prompt",
      summary: "Agent summary",
      lastModified: new Date("2026-02-01T10:00:00Z").getTime(),
      cwd: "/test/workspace",
    })

    const app = createTestApp()
    const res = await app.request("http://localhost/api/sessions/sess-agent-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "User renamed" }),
    })

    expect(res.status).toBe(200)

    // Verify session was imported and then renamed
    const row = getSessionRecord("sess-agent-1")
    expect(row).toBeDefined()
    expect(row!.status).toBe("complete")
    expect(row!.summary).toBe("User renamed")
  })

  it("returns 404 for completely unknown session ID", async () => {
    // Not in DB, findAgentSession returns null
    mockFindAgentSession.mockResolvedValue(null)

    const app = createTestApp()
    const res = await app.request("http://localhost/api/sessions/sess-unknown", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "Nope" }),
    })

    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toMatch(/not found/i)
  })

  it("imported session still serves transcript from JSONL via GET", async () => {
    // First, import via PATCH (agent-only session)
    mockFindAgentSession.mockResolvedValue({
      sessionId: "sess-jsonl-1",
      project: "test-workspace",
      firstPrompt: "JSONL prompt",
      summary: "JSONL summary",
      lastModified: new Date("2026-03-01T10:00:00Z").getTime(),
      cwd: "/test/workspace",
    })

    const mockTranscript = [
      { type: "human", message: { content: "Hello" } },
      { type: "assistant", message: { content: "Hi there" } },
    ]
    mockGetAgentSessionTranscript.mockResolvedValue(mockTranscript)

    const app = createTestApp()

    // PATCH to import + rename
    await app.request("http://localhost/api/sessions/sess-jsonl-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "Renamed JSONL session" }),
    })

    // GET the session - should fall back to JSONL transcript since
    // DB has no messages (session was imported, not started via inbox)
    const getRes = await app.request("http://localhost/api/sessions/sess-jsonl-1")
    expect(getRes.status).toBe(200)

    const data = await getRes.json()
    expect(data.session.summary).toBe("Renamed JSONL session")
    expect(data.messages).toHaveLength(2)
    expect(data.messages).toEqual(mockTranscript)
  })

  it("truncates summary to 200 chars", async () => {
    const db = dbHolder.db!
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO sessions (id, status, prompt, summary, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("sess-trunc", "complete", "Prompt", "Short", now, now)

    const longSummary = "X".repeat(300)
    const app = createTestApp()
    const res = await app.request("http://localhost/api/sessions/sess-trunc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: longSummary }),
    })

    expect(res.status).toBe(200)

    const row = getSessionRecord("sess-trunc")
    expect((row!.summary as string).length).toBeLessThanOrEqual(200)
  })
})
