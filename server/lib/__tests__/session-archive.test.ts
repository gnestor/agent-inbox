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
      // importAgentSession: ON CONFLICT DO NOTHING
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
    if (sql.includes("UPDATE sessions SET status = 'complete'") && sql.includes("status = 'archived'")) {
      // unarchiveSession: SET status = 'complete', updated_at = $1 WHERE id = $2 AND status = 'archived'
      const now = params![0] as string
      const id = params![1] as string
      const session = sessionsStore.get(id)
      if (!session || session.status !== "archived") return { rowCount: 0 }
      session.status = "complete"
      session.updated_at = now
      return { rowCount: 1 }
    }
    if (sql.includes("UPDATE sessions SET status")) {
      // updateSessionStatus — simulate atomic CAS behavior
      const status = params![0] as string
      const id = sql.includes("AND status = ANY") ? params![3] as string : params![params!.length - 1] as string
      const session = sessionsStore.get(id)
      if (!session) return { rowCount: 0 }

      // If the query has a CAS guard (AND status = ANY($5::text[])), check it
      if (sql.includes("AND status = ANY") && params![4]) {
        const validFrom = params![4] as string[]
        if (!validFrom.includes(session.status)) {
          return { rowCount: 0 } // CAS failed — current status not in valid set
        }
      }

      session.status = status
      if (params![1]) session.summary = params![1]
      session.updated_at = new Date().toISOString()
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

function insertSession(
  id: string,
  status: string = "complete",
) {
  const now = new Date().toISOString()
  sessionsStore.set(id, {
    id,
    status,
    prompt: "Test prompt",
    summary: "Test summary",
    started_at: now,
    updated_at: now,
  })
}

function createTestApp() {
  const app = new Hono()
  app.route("/api/sessions", sessionRoutes)
  return app
}

describe("archiveSession", () => {
  beforeEach(() => {
    sessionsStore.clear()
    messagesStore.clear()
    mockFindAgentSession.mockReset()
    mockGetAgentSessionTranscript.mockReset()
  })

  it("returns false for unknown session", async () => {
    const result = await archiveSession("nonexistent-id")
    expect(result).toBe(false)
  })

  it("Scenario: `archiveSession` / `unarchiveSession` flip status to/from `archived` — sets status to 'archived' for a non-running session", async () => {
    insertSession("sess-complete", "complete")

    const result = await archiveSession("sess-complete")
    expect(result).toBe(true)

    const row = await getSessionRecord("sess-complete")
    expect(row).toBeDefined()
    expect(row!.status).toBe("archived")
  })

  it("sets status to 'archived' for a running session and cleans up running state", async () => {
    insertSession("sess-running", "running")

    const result = await archiveSession("sess-running")
    expect(result).toBe(true)

    const row = await getSessionRecord("sess-running")
    expect(row!.status).toBe("archived")
  })

  it("unarchiveSession flips an archived row back to complete and returns false on no row", async () => {
    const { unarchiveSession } = await import("../session-manager.js")
    insertSession("sess-arch", "archived")
    expect(await unarchiveSession("sess-arch")).toBe(true)
    expect((await getSessionRecord("sess-arch"))!.status).toBe("complete")
    // Both helpers return false when no row exists.
    expect(await unarchiveSession("ghost")).toBe(false)
  })
})

describe("updateSessionStatus race condition guard", () => {
  beforeEach(() => {
    sessionsStore.clear()
    messagesStore.clear()
  })

  it("does not overwrite 'archived' status when 'complete' is applied", async () => {
    insertSession("sess-archived", "archived")

    await updateSessionStatus("sess-archived", "complete")

    const row = await getSessionRecord("sess-archived")
    expect(row!.status).toBe("archived")
  })

  it("does not overwrite 'archived' status when 'errored' is applied", async () => {
    insertSession("sess-archived2", "archived")

    await updateSessionStatus("sess-archived2", "errored", "some error")

    const row = await getSessionRecord("sess-archived2")
    expect(row!.status).toBe("archived")
  })

  it("allows setting 'complete' when current status is 'running'", async () => {
    insertSession("sess-running", "running")

    await updateSessionStatus("sess-running", "complete")

    const row = await getSessionRecord("sess-running")
    expect(row!.status).toBe("complete")
  })

  it("blocks setting 'running' when current status is 'archived'", async () => {
    insertSession("sess-archived3", "archived")

    await updateSessionStatus("sess-archived3", "running")

    const row = await getSessionRecord("sess-archived3")
    // Archived is terminal — CAS rejects the transition
    expect(row!.status).toBe("archived")
  })
})

describe("POST /sessions/:id/archive", () => {
  beforeEach(() => {
    sessionsStore.clear()
    messagesStore.clear()
    mockFindAgentSession.mockReset()
    mockGetAgentSessionTranscript.mockReset()
  })

  it("returns { ok: true } and archives a known session", async () => {
    insertSession("sess-to-archive", "complete")

    const app = createTestApp()
    const res = await app.request("http://localhost/api/sessions/sess-to-archive/archive", {
      method: "POST",
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)

    const row = await getSessionRecord("sess-to-archive")
    expect(row!.status).toBe("archived")
  })

  it("returns 404 for a session not in DB and not found by agent SDK", async () => {
    mockFindAgentSession.mockResolvedValue(null)

    const app = createTestApp()
    const res = await app.request("http://localhost/api/sessions/nonexistent/archive", {
      method: "POST",
    })

    expect(res.status).toBe(404)
  })

  it("imports and archives an agent-only session (not in DB)", async () => {
    const agentSession = {
      sessionId: "agent-only-session",
      firstPrompt: "Do something",
      summary: "Did something",
      lastModified: Date.now(),
      cwd: "/some/path",
      project: "test-workspace",
    }
    mockFindAgentSession.mockResolvedValue(agentSession)

    const app = createTestApp()
    const res = await app.request(
      "http://localhost/api/sessions/agent-only-session/archive",
      { method: "POST" },
    )

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)

    const row = await getSessionRecord("agent-only-session")
    expect(row).toBeDefined()
    expect(row!.status).toBe("archived")
  })
})
