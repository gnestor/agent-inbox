import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"

process.env.VAULT_SECRET = "aa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"

// In-memory store for sessions
const sessionsStore = new Map<string, any>()
const messagesStore = new Map<string, any[]>()

vi.mock("../../db/pool.js", () => ({
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM sessions")) {
      return [...sessionsStore.values()]
    }
    return []
  }),
  queryOne: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM sessions") && sql.includes("WHERE id")) {
      const id = params![0] as string
      return sessionsStore.get(id) || undefined
    }
    if (sql.includes("SELECT status FROM sessions")) {
      const id = params![0] as string
      const s = sessionsStore.get(id)
      return s ? { status: s.status } : undefined
    }
    return undefined
  }),
  execute: vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("INSERT INTO sessions")) {
      const id = params![0] as string
      if (!sessionsStore.has(id)) {
        sessionsStore.set(id, {
          id,
          status: "complete",
          prompt: params![1],
          summary: params![2],
          started_at: params![3],
          updated_at: params![4],
          completed_at: params![5],
          trigger_source: "manual",
        })
      }
      return { rowCount: 1 }
    }
    if (sql.includes("UPDATE sessions SET summary")) {
      const summary = params![0] as string
      const id = params![2] as string
      const session = sessionsStore.get(id)
      if (session) {
        session.summary = summary
        session.updated_at = params![1] as string
      }
      return { rowCount: 1 }
    }
    if (sql.includes("UPDATE sessions SET status")) {
      const id = params![params!.length - 1] as string
      const status = params![0] as string
      const session = sessionsStore.get(id)
      if (session) {
        session.status = status
        session.updated_at = new Date().toISOString()
      }
      return { rowCount: 1 }
    }
    return { rowCount: 0 }
  }),
  withTransaction: vi.fn(async (fn: any) => fn({
    query: vi.fn(async () => ({ rows: [] })),
  })),
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
const { getSessionRecord } = await import(
  "../session-manager.js"
)

function createTestApp() {
  const app = new Hono()
  app.route("/api/sessions", sessionRoutes)
  return app
}

describe("PATCH /sessions/:id", () => {
  beforeEach(() => {
    sessionsStore.clear()
    messagesStore.clear()
    mockFindAgentSession.mockReset()
    mockGetAgentSessionTranscript.mockReset()
  })

  it("returns 200 and updates summary for a DB session", async () => {
    const now = new Date().toISOString()
    sessionsStore.set("sess-db-1", {
      id: "sess-db-1",
      status: "complete",
      prompt: "Original prompt",
      summary: "Old summary",
      started_at: now,
      updated_at: now,
    })

    const app = createTestApp()
    const res = await app.request("http://localhost/api/sessions/sess-db-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "New renamed summary" }),
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)

    const row = await getSessionRecord("sess-db-1")
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

    const row = await getSessionRecord("sess-agent-1")
    expect(row).toBeDefined()
    expect(row!.status).toBe("complete")
    expect(row!.summary).toBe("User renamed")
  })

  it("returns 404 for completely unknown session ID", async () => {
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

    // GET the session
    const getRes = await app.request("http://localhost/api/sessions/sess-jsonl-1")
    expect(getRes.status).toBe(200)

    const data = await getRes.json()
    expect(data.session.summary).toBe("Renamed JSONL session")
    // First message is prepended user prompt, then JSONL messages
    expect(data.messages).toHaveLength(3)
    expect(data.messages[0].type).toBe("user")
    expect(data.messages[1].type).toBe("human")
    expect(data.messages[2].type).toBe("assistant")
  })

  it("truncates summary to 200 chars", async () => {
    const now = new Date().toISOString()
    sessionsStore.set("sess-trunc", {
      id: "sess-trunc",
      status: "complete",
      prompt: "Prompt",
      summary: "Short",
      started_at: now,
      updated_at: now,
    })

    const longSummary = "X".repeat(300)
    const app = createTestApp()
    const res = await app.request("http://localhost/api/sessions/sess-trunc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: longSummary }),
    })

    expect(res.status).toBe(200)

    const row = await getSessionRecord("sess-trunc")
    expect((row!.summary as string).length).toBeLessThanOrEqual(200)
  })
})
