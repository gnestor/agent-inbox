import { vi, describe, it, expect, beforeEach } from "vitest"
import { Hono } from "hono"
import type { AppBindings } from "../../lib/workspace-context.js"

// ---------------------------------------------------------------------------
// Mock session-manager — all exports used by the route file
// ---------------------------------------------------------------------------

const mockStartSession = vi.fn()
const mockListAllAgentSessions = vi.fn()
const mockSearchAgentSessions = vi.fn()
const mockListSessionRecords = vi.fn()
const mockGetSessionRecord = vi.fn()
const mockFindAgentSession = vi.fn()
const mockGetAgentSessionTranscript = vi.fn()
const mockIsSessionRunning = vi.fn()
const mockUpdateSessionStatus = vi.fn()
const mockUpdateSessionSummary = vi.fn()
const mockImportAgentSession = vi.fn()
const mockProvideAskUserAnswer = vi.fn()
const mockResumeSessionQuery = vi.fn()
const mockAttachSourceToSession = vi.fn()
const mockAbortRunningSession = vi.fn()
const mockArchiveSession = vi.fn()
const mockUnarchiveSession = vi.fn()
const mockPatchArtifactCode = vi.fn()
const mockGetWorkspacePath = vi.fn(() => "/workspace")
const mockProjectLabel = vi.fn(() => "test-project")
const mockAddPresenceUser = vi.fn()
const mockRemovePresenceUser = vi.fn()
const mockGetLinkedSession = vi.fn()
const mockListProjectOptions = vi.fn()
const mockBroadcastToSession = vi.fn()

vi.mock("../../lib/session-manager.js", () => ({
  startSession: (...args: unknown[]) => mockStartSession(...args),
  listAllAgentSessions: (...args: unknown[]) => mockListAllAgentSessions(...args),
  searchAgentSessions: (...args: unknown[]) => mockSearchAgentSessions(...args),
  listSessionRecords: (...args: unknown[]) => mockListSessionRecords(...args),
  getSessionRecord: (...args: unknown[]) => mockGetSessionRecord(...args),
  findAgentSession: (...args: unknown[]) => mockFindAgentSession(...args),
  getAgentSessionTranscript: (...args: unknown[]) => mockGetAgentSessionTranscript(...args),
  isSessionRunning: (...args: unknown[]) => mockIsSessionRunning(...args),
  updateSessionStatus: (...args: unknown[]) => mockUpdateSessionStatus(...args),
  updateSessionSummary: (...args: unknown[]) => mockUpdateSessionSummary(...args),
  importAgentSession: (...args: unknown[]) => mockImportAgentSession(...args),
  provideAskUserAnswer: (...args: unknown[]) => mockProvideAskUserAnswer(...args),
  resumeSessionQuery: (...args: unknown[]) => mockResumeSessionQuery(...args),
  attachSourceToSession: (...args: unknown[]) => mockAttachSourceToSession(...args),
  abortRunningSession: (...args: unknown[]) => mockAbortRunningSession(...args),
  archiveSession: (...args: unknown[]) => mockArchiveSession(...args),
  unarchiveSession: (...args: unknown[]) => mockUnarchiveSession(...args),
  patchArtifactCode: (...args: unknown[]) => mockPatchArtifactCode(...args),
  getWorkspacePath: () => mockGetWorkspacePath(),
  projectLabel: (...args: unknown[]) => (mockProjectLabel as (...args: unknown[]) => unknown)(...args),
  addPresenceUser: (...args: unknown[]) => mockAddPresenceUser(...args),
  removePresenceUser: (...args: unknown[]) => mockRemovePresenceUser(...args),
  getLinkedSession: (...args: unknown[]) => mockGetLinkedSession(...args),
  listProjectOptions: (...args: unknown[]) => mockListProjectOptions(...args),
  broadcastToSession: (...args: unknown[]) => mockBroadcastToSession(...args),
}))

vi.mock("../../lib/session-files.js", () => ({
  getSessionFilesDir: vi.fn(),
  saveSessionFile: vi.fn(),
  getSessionFilePath: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Test app setup — inject minimal workspace context
// ---------------------------------------------------------------------------

import { sessionRoutes } from "../sessions.js"

function createApp() {
  const app = new Hono<AppBindings>()
  // Middleware to set workspace context (routes read c.get("workspace"))
  app.use("*", async (c, next) => {
    c.set("workspace", { id: "ws-1", name: "test", path: "/workspace", role: "admin" })
    c.set("user", { name: "Test User", email: "test@example.com" })
    await next()
  })
  app.route("/sessions", sessionRoutes)
  return app
}

/** Helper to POST JSON */
function postJson(app: Hono<AppBindings>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Helper to PATCH JSON */
function patchJson(app: Hono<AppBindings>, path: string, body: unknown) {
  return app.request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session routes", () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    vi.clearAllMocks()
    app = createApp()
    // Sensible defaults
    mockListSessionRecords.mockResolvedValue([])
    mockListAllAgentSessions.mockResolvedValue([])
    mockSearchAgentSessions.mockResolvedValue([])
    mockGetAgentSessionTranscript.mockResolvedValue([])
  })

  // =========================================================================
  // POST / — create session
  // =========================================================================

  describe("POST /sessions", () => {
    it("creates a session with a valid prompt", async () => {
      mockStartSession.mockResolvedValue("sess-001")
      const res = await postJson(app, "/sessions", { prompt: "Hello world" })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.sessionId).toBe("sess-001")
      expect(mockStartSession).toHaveBeenCalledWith(
        "Hello world",
        expect.objectContaining({ triggerSource: "manual", workspacePath: "/workspace" }),
      )
    })

    it("passes optional linked source fields", async () => {
      mockStartSession.mockResolvedValue("sess-002")
      const res = await postJson(app, "/sessions", {
        prompt: "Help with email",
        linkedSourceType: "email",
        linkedSourceId: "msg-123",
        linkedSourceContent: "Email body here",
        linkedItemTitle: "Re: Important",
      })
      expect(res.status).toBe(200)
      expect(mockStartSession).toHaveBeenCalledWith(
        "Help with email",
        expect.objectContaining({
          linkedSourceType: "email",
          linkedSourceId: "msg-123",
          linkedSourceContent: "Email body here",
          linkedItemTitle: "Re: Important",
        }),
      )
    })

    it("returns 400 when prompt is missing", async () => {
      const res = await postJson(app, "/sessions", {})
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBeDefined()
    })

    it("returns 400 when prompt is empty string", async () => {
      const res = await postJson(app, "/sessions", { prompt: "" })
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toBeDefined()
    })

    it("returns 500 when startSession throws", async () => {
      mockStartSession.mockRejectedValue(new Error("SDK failure"))
      const res = await postJson(app, "/sessions", { prompt: "test" })
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toBe("SDK failure")
    })
  })

  // =========================================================================
  // GET / — list sessions
  // =========================================================================

  describe("GET /sessions", () => {
    it("returns an empty list when there are no sessions", async () => {
      const res = await app.request("/sessions")
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.sessions).toEqual([])
    })

    it("returns sessions enriched with DB metadata", async () => {
      const now = new Date().toISOString()
      mockListAllAgentSessions.mockResolvedValue([
        {
          sessionId: "s1",
          firstPrompt: "Do stuff",
          summary: "JSONL summary",
          lastModified: Date.now(),
          project: "test",
        },
      ])
      mockListSessionRecords.mockResolvedValue([
        {
          id: "s1",
          status: "running",
          prompt: "Do stuff",
          summary: "DB summary",
          started_at: now,
          updated_at: now,
          completed_at: null,
          linked_source_type: null,
          linked_source_id: null,
          trigger_source: "manual",
          linked_item_title: null,
        },
      ])

      const res = await app.request("/sessions")
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.sessions).toHaveLength(1)
      expect(data.sessions[0].id).toBe("s1")
      // DB summary takes priority
      expect(data.sessions[0].summary).toBe("DB summary")
      expect(data.sessions[0].status).toBe("running")
    })

    it("filters sessions by status query param", async () => {
      const now = new Date().toISOString()
      mockListAllAgentSessions.mockResolvedValue([
        { sessionId: "s1", firstPrompt: "A", summary: null, lastModified: Date.now(), project: "t" },
        { sessionId: "s2", firstPrompt: "B", summary: null, lastModified: Date.now(), project: "t" },
      ])
      mockListSessionRecords.mockResolvedValue([
        { id: "s1", status: "running", prompt: "A", summary: null, started_at: now, updated_at: now, completed_at: null, linked_source_type: null, linked_source_id: null, trigger_source: "manual", linked_item_title: null },
        { id: "s2", status: "complete", prompt: "B", summary: null, started_at: now, updated_at: now, completed_at: now, linked_source_type: null, linked_source_id: null, trigger_source: "manual", linked_item_title: null },
      ])

      const res = await app.request("/sessions?status=running")
      const data = await res.json()
      expect(data.sessions).toHaveLength(1)
      expect(data.sessions[0].status).toBe("running")
    })

    it("uses searchAgentSessions when q param is present", async () => {
      mockSearchAgentSessions.mockResolvedValue([])
      const res = await app.request("/sessions?q=hello")
      expect(res.status).toBe(200)
      expect(mockSearchAgentSessions).toHaveBeenCalledWith("hello", "/workspace")
      expect(mockListAllAgentSessions).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // GET /:id — get single session
  // =========================================================================

  describe("GET /sessions/:id", () => {
    it("returns session from DB record with transcript", async () => {
      mockGetSessionRecord.mockResolvedValue({
        id: "s1",
        status: "complete",
        prompt: "Test",
        summary: "Summary",
        started_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        completed_at: "2026-01-01T00:00:00Z",
        linked_source_type: null,
        linked_source_id: null,
        trigger_source: "manual",
      })
      mockFindAgentSession.mockResolvedValue({
        sessionId: "s1",
        cwd: "/workspace",
      })
      mockGetAgentSessionTranscript.mockResolvedValue([{ type: "user", text: "Test" }])
      mockIsSessionRunning.mockReturnValue(false)

      const res = await app.request("/sessions/s1")
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.session.id).toBe("s1")
      expect(data.session.status).toBe("complete")
      expect(data.messages).toHaveLength(1)
    })

    it("corrects stale 'running' status when no active process", async () => {
      mockGetSessionRecord.mockResolvedValue({
        id: "s1",
        status: "running",
        prompt: "Test",
        summary: null,
        started_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        completed_at: null,
        linked_source_type: null,
        linked_source_id: null,
        trigger_source: "manual",
      })
      mockFindAgentSession.mockResolvedValue(null)
      mockIsSessionRunning.mockReturnValue(false)
      mockUpdateSessionStatus.mockResolvedValue(undefined)

      const res = await app.request("/sessions/s1")
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.session.status).toBe("complete")
      expect(mockUpdateSessionStatus).toHaveBeenCalledWith("s1", "complete")
    })

    it("falls back to agent session when not in DB", async () => {
      mockGetSessionRecord.mockResolvedValue(null)
      mockFindAgentSession.mockResolvedValue({
        sessionId: "agent-only",
        firstPrompt: "Agent prompt",
        summary: "Agent summary",
        lastModified: new Date("2026-03-01T00:00:00Z").getTime(),
        cwd: "/workspace",
      })
      mockGetAgentSessionTranscript.mockResolvedValue([])

      const res = await app.request("/sessions/agent-only")
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.session.id).toBe("agent-only")
      expect(data.session.status).toBe("complete")
      expect(data.session.summary).toBe("Agent summary")
    })

    it("returns 404 when session not found anywhere", async () => {
      mockGetSessionRecord.mockResolvedValue(null)
      mockFindAgentSession.mockResolvedValue(null)

      const res = await app.request("/sessions/nonexistent")
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe("Session not found")
    })
  })

  // =========================================================================
  // PATCH /:id — update summary
  // =========================================================================

  describe("PATCH /sessions/:id", () => {
    it("updates summary for a DB session", async () => {
      mockGetSessionRecord.mockResolvedValue({ id: "s1", status: "complete" })
      mockUpdateSessionSummary.mockResolvedValue(undefined)

      const res = await patchJson(app, "/sessions/s1", { summary: "New name" })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(mockUpdateSessionSummary).toHaveBeenCalledWith("s1", "New name")
    })

    it("imports agent-only session before updating", async () => {
      mockGetSessionRecord.mockResolvedValue(null)
      mockFindAgentSession.mockResolvedValue({
        sessionId: "agent-s1",
        firstPrompt: "test",
        summary: null,
        lastModified: Date.now(),
      })
      mockImportAgentSession.mockResolvedValue(undefined)
      mockUpdateSessionSummary.mockResolvedValue(undefined)

      const res = await patchJson(app, "/sessions/agent-s1", { summary: "Renamed" })
      expect(res.status).toBe(200)
      expect(mockImportAgentSession).toHaveBeenCalledWith("agent-s1", expect.any(Object))
      expect(mockUpdateSessionSummary).toHaveBeenCalledWith("agent-s1", "Renamed")
    })

    it("returns 404 when session not found in DB or agent", async () => {
      mockGetSessionRecord.mockResolvedValue(null)
      mockFindAgentSession.mockResolvedValue(null)

      const res = await patchJson(app, "/sessions/missing", { summary: "test" })
      expect(res.status).toBe(404)
    })

    it("returns 400 when summary is missing from body", async () => {
      const res = await patchJson(app, "/sessions/s1", {})
      expect(res.status).toBe(400)
    })

    it("truncates summary to 200 characters", async () => {
      mockGetSessionRecord.mockResolvedValue({ id: "s1", status: "complete" })
      mockUpdateSessionSummary.mockResolvedValue(undefined)

      const longSummary = "A".repeat(300)
      const res = await patchJson(app, "/sessions/s1", { summary: longSummary })
      expect(res.status).toBe(200)
      // Route slices to 200
      expect(mockUpdateSessionSummary).toHaveBeenCalledWith("s1", "A".repeat(200))
    })
  })

  // =========================================================================
  // POST /:id/answer — answer question
  // =========================================================================

  describe("POST /sessions/:id/answer", () => {
    it("provides answer to pending question", async () => {
      mockProvideAskUserAnswer.mockReturnValue(true)

      const res = await postJson(app, "/sessions/s1/answer", {
        answers: { "What color?": "Blue" },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(mockProvideAskUserAnswer).toHaveBeenCalledWith("s1", { "What color?": "Blue" })
    })

    it("falls back to resume when no pending resolver", async () => {
      mockProvideAskUserAnswer.mockReturnValue(false)
      mockResumeSessionQuery.mockResolvedValue(undefined)

      const res = await postJson(app, "/sessions/s1/answer", {
        answers: { "What color?": "Blue" },
      })
      expect(res.status).toBe(200)
      expect(mockResumeSessionQuery).toHaveBeenCalledWith(
        "s1",
        "What color?: Blue",
        undefined, // cookie
        expect.objectContaining({ name: "Test User" }),
      )
    })

    it("returns 400 when answers field is missing", async () => {
      const res = await postJson(app, "/sessions/s1/answer", {})
      expect(res.status).toBe(400)
    })

    it("returns 400 when answers is not a record of strings", async () => {
      const res = await postJson(app, "/sessions/s1/answer", {
        answers: { key: 123 },
      })
      expect(res.status).toBe(400)
    })

    it("returns 500 when resume fallback fails", async () => {
      mockProvideAskUserAnswer.mockReturnValue(false)
      mockResumeSessionQuery.mockRejectedValue(new Error("resume failed"))

      const res = await postJson(app, "/sessions/s1/answer", {
        answers: { "Q": "A" },
      })
      expect(res.status).toBe(500)
      const data = await res.json()
      expect(data.error).toBe("Failed to resume session")
    })
  })

  // =========================================================================
  // POST /:id/resume — resume session
  // =========================================================================

  describe("POST /sessions/:id/resume", () => {
    it("resumes an existing DB session", async () => {
      mockGetSessionRecord.mockResolvedValue({ id: "s1", status: "complete" })
      mockResumeSessionQuery.mockResolvedValue({ started: true })

      const res = await postJson(app, "/sessions/s1/resume", { prompt: "Continue" })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(mockResumeSessionQuery).toHaveBeenCalledWith(
        "s1",
        "Continue",
        undefined, // cookie
        expect.objectContaining({ name: "Test User" }),
      )
    })

    it("imports agent-only session before resuming", async () => {
      mockGetSessionRecord.mockResolvedValue(null)
      mockFindAgentSession.mockResolvedValue({
        sessionId: "agent-s1",
        firstPrompt: "prev",
        summary: null,
        lastModified: Date.now(),
      })
      mockImportAgentSession.mockResolvedValue(undefined)
      mockResumeSessionQuery.mockResolvedValue({ started: true })

      const res = await postJson(app, "/sessions/agent-s1/resume", { prompt: "Go on" })
      expect(res.status).toBe(200)
      expect(mockImportAgentSession).toHaveBeenCalledWith("agent-s1", expect.any(Object))
    })

    it("returns 404 when session not found", async () => {
      mockGetSessionRecord.mockResolvedValue(null)
      mockFindAgentSession.mockResolvedValue(null)

      const res = await postJson(app, "/sessions/missing/resume", { prompt: "test" })
      expect(res.status).toBe(404)
    })

    it("returns 400 when prompt is missing", async () => {
      const res = await postJson(app, "/sessions/s1/resume", {})
      expect(res.status).toBe(400)
    })

    it("returns 400 when prompt is empty string", async () => {
      const res = await postJson(app, "/sessions/s1/resume", { prompt: "" })
      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // POST /:id/attach — attach source to session
  // =========================================================================

  describe("POST /sessions/:id/attach", () => {
    it("attaches a source to an existing DB session", async () => {
      mockGetSessionRecord.mockResolvedValue({ id: "s1", status: "running" })
      mockAttachSourceToSession.mockResolvedValue(undefined)

      const res = await postJson(app, "/sessions/s1/attach", {
        type: "email",
        id: "msg-1",
        title: "Re: Hello",
        content: "Email body content",
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(mockAttachSourceToSession).toHaveBeenCalledWith("s1", {
        type: "email",
        id: "msg-1",
        title: "Re: Hello",
        content: "Email body content",
      })
    })

    it("imports agent-only session before attaching", async () => {
      mockGetSessionRecord.mockResolvedValue(null)
      mockFindAgentSession.mockResolvedValue({
        sessionId: "agent-s1",
        firstPrompt: "test",
        summary: null,
        lastModified: Date.now(),
      })
      mockImportAgentSession.mockResolvedValue(undefined)
      mockAttachSourceToSession.mockResolvedValue(undefined)

      const res = await postJson(app, "/sessions/agent-s1/attach", {
        type: "task",
        id: "task-1",
        content: "Task details",
      })
      expect(res.status).toBe(200)
      expect(mockImportAgentSession).toHaveBeenCalled()
    })

    it("uses fallback title when title is omitted", async () => {
      mockGetSessionRecord.mockResolvedValue({ id: "s1", status: "running" })
      mockAttachSourceToSession.mockResolvedValue(undefined)

      const res = await postJson(app, "/sessions/s1/attach", {
        type: "email",
        id: "msg-5",
        content: "Some content",
      })
      expect(res.status).toBe(200)
      expect(mockAttachSourceToSession).toHaveBeenCalledWith("s1", {
        type: "email",
        id: "msg-5",
        title: "email msg-5",
        content: "Some content",
      })
    })

    it("returns 404 when session not found", async () => {
      mockGetSessionRecord.mockResolvedValue(null)
      mockFindAgentSession.mockResolvedValue(null)

      const res = await postJson(app, "/sessions/missing/attach", {
        type: "email",
        id: "msg-1",
        content: "body",
      })
      expect(res.status).toBe(404)
    })

    it("returns 400 when required fields are missing", async () => {
      const res = await postJson(app, "/sessions/s1/attach", { type: "email" })
      expect(res.status).toBe(400)
    })

    it("returns 400 when content is empty", async () => {
      const res = await postJson(app, "/sessions/s1/attach", {
        type: "email",
        id: "msg-1",
        content: "",
      })
      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // POST /:id/abort — abort session
  // =========================================================================

  describe("POST /sessions/:id/abort", () => {
    it("aborts a running session", async () => {
      mockAbortRunningSession.mockResolvedValue(true)

      const res = await postJson(app, "/sessions/s1/abort", {})
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(mockAbortRunningSession).toHaveBeenCalledWith("s1")
    })

    it("returns ok: false when session is not running", async () => {
      mockAbortRunningSession.mockResolvedValue(false)

      const res = await postJson(app, "/sessions/s1/abort", {})
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(false)
    })
  })

  // =========================================================================
  // POST /:id/archive — archive session
  // =========================================================================

  describe("POST /sessions/:id/archive", () => {
    it("archives an existing DB session", async () => {
      mockGetSessionRecord.mockResolvedValue({ id: "s1", status: "complete" })
      mockArchiveSession.mockResolvedValue(true)

      const res = await postJson(app, "/sessions/s1/archive", {})
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
    })

    it("imports agent-only session before archiving", async () => {
      mockGetSessionRecord.mockResolvedValue(null)
      mockFindAgentSession.mockResolvedValue({
        sessionId: "agent-s1",
        firstPrompt: "test",
        summary: null,
        lastModified: Date.now(),
      })
      mockImportAgentSession.mockResolvedValue(undefined)
      mockArchiveSession.mockResolvedValue(true)

      const res = await postJson(app, "/sessions/agent-s1/archive", {})
      expect(res.status).toBe(200)
      expect(mockImportAgentSession).toHaveBeenCalled()
    })

    it("returns 404 when session not found", async () => {
      mockGetSessionRecord.mockResolvedValue(null)
      mockFindAgentSession.mockResolvedValue(null)

      const res = await postJson(app, "/sessions/missing/archive", {})
      expect(res.status).toBe(404)
    })
  })

  // =========================================================================
  // POST /:id/unarchive — unarchive session
  // =========================================================================

  describe("POST /sessions/:id/unarchive", () => {
    it("unarchives a session", async () => {
      mockUnarchiveSession.mockResolvedValue(true)

      const res = await postJson(app, "/sessions/s1/unarchive", {})
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
    })

    it("returns 404 when session not found or not archived", async () => {
      mockUnarchiveSession.mockResolvedValue(false)

      const res = await postJson(app, "/sessions/s1/unarchive", {})
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe("Session not found or not archived")
    })
  })

  // =========================================================================
  // PATCH /:id/artifact — patch artifact code
  // =========================================================================

  describe("PATCH /sessions/:id/artifact", () => {
    it("patches artifact code successfully", async () => {
      mockPatchArtifactCode.mockResolvedValue(true)

      const res = await patchJson(app, "/sessions/s1/artifact", {
        toolUseId: "toolu_abc",
        code: "console.log('hello')",
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(mockPatchArtifactCode).toHaveBeenCalledWith("s1", "toolu_abc", "console.log('hello')")
    })

    it("returns 404 when no tool_use matches the id", async () => {
      mockPatchArtifactCode.mockResolvedValue(false)

      const res = await patchJson(app, "/sessions/s1/artifact", {
        toolUseId: "toolu_missing",
        code: "test",
      })
      expect(res.status).toBe(404)
      const data = await res.json()
      expect(data.error).toBe("Artifact not found for the given tool_use id")
    })

    it("returns 400 when toolUseId is missing", async () => {
      const res = await patchJson(app, "/sessions/s1/artifact", { code: "test" })
      expect(res.status).toBe(400)
    })

    it("returns 400 when code is missing", async () => {
      const res = await patchJson(app, "/sessions/s1/artifact", { toolUseId: "toolu_abc" })
      expect(res.status).toBe(400)
    })

    it("returns 400 when toolUseId is empty", async () => {
      const res = await patchJson(app, "/sessions/s1/artifact", {
        toolUseId: "",
        code: "test",
      })
      expect(res.status).toBe(400)
    })
  })
})
