import { Hono } from "hono"
import { getCookie } from "hono/cookie"
import { readFileSync } from "fs"
import { resolve, normalize, basename, sep } from "path"
import { SESSION_COOKIE } from "./auth.js"
import * as sessions from "../lib/session-manager.js"
import { getSessionFilesDir, saveSessionFile, getSessionFilePath } from "../lib/session-files.js"
import type { AppBindings } from "../lib/workspace-context.js"
import {
  CreateSessionBody,
  ResumeSessionBody,
  UpdateSessionBody,
  AnswerSessionBody,
  AttachToSessionBody,
  PatchArtifactBody,

} from "../lib/schemas.js"
import type { ZodError } from "zod/v4"
import { createLogger } from "../lib/logger.js"
import { rateLimit, getClientIp } from "../lib/rate-limit.js"

const log = createLogger("routes:sessions")

type UserProfile = { name: string; email: string; picture?: string }

/**
 * The Agent SDK JSONL doesn't include the initial user prompt (it's passed
 * as an argument, not emitted in the message stream). Prepend a synthetic
 * user message so REST responses match what the WS broadcast emits at seq 0.
 */
function withInitialUserPrompt(
  transcript: Array<Record<string, unknown>>,
  sessionId: string,
  prompt: string,
  createdAt: string,
) {
  if (transcript.length > 0 && transcript[0]!.type === "user") return transcript
  return [
    {
      id: 0,
      sessionId,
      sequence: 0,
      type: "user",
      message: { type: "user", role: "user", content: prompt },
      createdAt,
    },
    ...transcript,
  ]
}

/** Extract first user-facing message from a Zod validation error */
function zodErrorMessage(err: ZodError): string {
  return err.issues[0]?.message ?? "Invalid request body"
}

export const sessionRoutes = new Hono<AppBindings>()

sessionRoutes.post("/", rateLimit({
  windowMs: 60_000,
  max: 10,
  label: "session-create",
  keyFn: (c) => {
    const email = c.get("userEmail") as string | undefined
    return email ?? getClientIp(c)
  },
}), async (c) => {
  let body: CreateSessionBody
  try {
    body = CreateSessionBody.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: zodErrorMessage(err as ZodError) }, 400)
  }

  const userSessionToken = getCookie(c, SESSION_COOKIE)

  try {
    const workspace = c.get("workspace")
    const sessionId = await sessions.startSession(body.prompt, {
      linkedSourceType: body.linkedSourceType,
      linkedSourceId: body.linkedSourceId,
      linkedSourceContent: body.linkedSourceContent,
      linkedItemTitle: body.linkedItemTitle,
      triggerSource: "manual",
      userSessionToken,
      workspacePath: workspace?.path,
    })
    return c.json({ sessionId })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start session"
    log.error("Failed to start session", { error: String(err) })
    return c.json({ error: message }, 500)
  }
})

sessionRoutes.get("/", async (c) => {
  const status = c.req.query("status")
  const q = c.req.query("q")

  // Resolve active workspace — sessions come from ~/.claude/projects/{encoded-path}/
  const workspace = c.get("workspace")
  const wsPath = workspace?.path || sessions.getWorkspacePath()

  // Fetch sessions from the workspace's JSONL files
  const agentSessions = await (q
    ? sessions.searchAgentSessions(q, wsPath)
    : sessions.listAllAgentSessions(wsPath)
  ).catch((err: unknown) => {
    log.error("listAllAgentSessions failed", { error: String(err) })
    return [] as Awaited<ReturnType<typeof sessions.listAllAgentSessions>>
  })

  // Enrich with DB metadata (status overrides, summaries, linked items)
  const dbRecords = new Map<string, sessions.SessionDbRow>()
  if (agentSessions.length > 0) {
    // Don't filter by q here — we need DB records for all sessions found by the
    // JSONL search, regardless of whether their prompt/summary matches q.
    // (searchAgentSessions is case-insensitive; LIKE is not, so filtering by q
    // would silently miss DB records and fall back to raw firstPrompt as summary.)
    const allDbSessions = await sessions.listSessionRecords()
    for (const s of allDbSessions) {
      dbRecords.set(s.id, s)
    }
  }

  let results = agentSessions.map((s) => {
    const db = dbRecords.get(s.sessionId)
    const prompt = db ? (db.prompt || s.firstPrompt || "") : (s.firstPrompt || "")
    // DB record takes priority for status, summary, and linked items
    if (db) {
      return {
        id: s.sessionId,
        status: db.status,
        prompt,
        summary: db.summary || s.summary || null,
        startedAt: db.started_at || new Date(s.lastModified).toISOString(),
        updatedAt: db.updated_at || new Date(s.lastModified).toISOString(),
        completedAt: db.completed_at || null,
        linkedSourceType: db.linked_source_type || null,
        linkedSourceId: db.linked_source_id || null,
        triggerSource: db.trigger_source || "manual" as const,
        project: s.project,
        linkedItemTitle: db.linked_item_title || null,
      }
    }
    return {
      id: s.sessionId,
      status: "complete" as const,
      prompt,
      summary: s.summary || null,
      startedAt: new Date(s.lastModified).toISOString(),
      updatedAt: new Date(s.lastModified).toISOString(),
      completedAt: new Date(s.lastModified).toISOString(),
      linkedSourceType: null,
      linkedSourceId: null,
      triggerSource: "manual" as const,
      project: s.project,
      linkedItemTitle: null,
    }
  })

  // Apply status filter. If no status filter is set, hide archived by default —
  // the user can opt in by selecting "archived" in the status filter.
  if (status) {
    const statuses = status.split(",")
    results = results.filter((s) => statuses.includes(s.status))
  } else {
    results = results.filter((s) => s.status !== "archived")
  }

  // Sort by most recently updated
  results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return c.json({ sessions: results })
})

sessionRoutes.get("/projects", async (c) => {
  const projects = await sessions.listProjectOptions()
  return c.json({ projects })
})

sessionRoutes.get("/linked", async (c) => {
  const sourceType = c.req.query("sourceType")
  const sourceId = c.req.query("sourceId")
  const session = await sessions.getLinkedSession(sourceType, sourceId)
  if (!session) return c.json({ session: null })
  return c.json({
    session: {
      id: session.id,
      status: session.status,
      prompt: session.prompt,
      summary: session.summary,
      updatedAt: session.updated_at,
    },
  })
})

sessionRoutes.get("/:id", async (c) => {
  const sessionId = c.req.param("id")
  const session = await sessions.getSessionRecord(sessionId)

  if (session) {
    // JSONL is the source of truth for session transcript; WS pushes live updates.
    const agentSession = await sessions.findAgentSession(sessionId)
    const transcript = agentSession
      ? await sessions.getAgentSessionTranscript(sessionId, agentSession.cwd)
      : []

    const messages = withInitialUserPrompt(transcript, sessionId, session.prompt as string, session.started_at as string)

    // If DB says "running" but no active process and JSONL has ended,
    // correct the status to "complete" (stale from server restart)
    let status = session.status
    if ((status === "running" || status === "awaiting_user_input") && !sessions.isSessionRunning(session.id)) {
      status = "complete"
      sessions.updateSessionStatus(session.id, "complete").catch((err) => log.warn("Failed to update stale session status", { sessionId: session.id, error: String(err) }))
    }

    return c.json({
      session: {
        id: session.id,
        status,
        prompt: session.prompt,
        summary: session.summary,
        startedAt: session.started_at,
        updatedAt: session.updated_at,
        completedAt: session.completed_at,
        linkedSourceType: session.linked_source_type || null,
        linkedSourceId: session.linked_source_id || null,
        triggerSource: session.trigger_source,
        project: sessions.projectLabel(c.get("workspace")?.path || sessions.getWorkspacePath()),
        hasActiveProcess: sessions.isSessionRunning(session.id),
      },
      messages,
    })
  }

  // Fallback: look up session from Agent SDK (CC sessions not in local DB)
  const agentSession = await sessions.findAgentSession(sessionId)

  if (!agentSession) {
    return c.json({ error: "Session not found" }, 404)
  }

  // Read the transcript from the Agent SDK session (pass cwd so we find the right project)
  const sdkTranscript = await sessions.getAgentSessionTranscript(sessionId, agentSession.cwd)
  const prompt = agentSession.firstPrompt || ""
  const transcript = withInitialUserPrompt(sdkTranscript, sessionId, prompt, new Date(agentSession.lastModified).toISOString())

  return c.json({
    session: {
      id: agentSession.sessionId,
      status: "complete",
      prompt,
      summary: agentSession.summary || agentSession.firstPrompt || null,
      startedAt: new Date(agentSession.lastModified).toISOString(),
      updatedAt: new Date(agentSession.lastModified).toISOString(),
      completedAt: new Date(agentSession.lastModified).toISOString(),
      linkedSourceType: null,
      linkedSourceId: null,
      triggerSource: "manual",
    },
    messages: transcript,
  })
})

sessionRoutes.patch("/:id", async (c) => {
  const sessionId = c.req.param("id")
  let body: UpdateSessionBody
  try {
    body = UpdateSessionBody.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: zodErrorMessage(err as ZodError) }, 400)
  }
  const { summary } = body

  let session = await sessions.getSessionRecord(sessionId)
  if (!session) {
    // Agent-only session (JSONL, not in DB) — import a minimal completed record
    const agentSession = await sessions.findAgentSession(sessionId)
    if (!agentSession) {
      return c.json({ error: "Session not found" }, 404)
    }
    await sessions.importAgentSession(sessionId, agentSession)
  }

  await sessions.updateSessionSummary(sessionId, summary.slice(0, 200))
  return c.json({ ok: true })
})

sessionRoutes.post("/:id/answer", async (c) => {
  const sessionId = c.req.param("id")
  let body: AnswerSessionBody
  try {
    body = AnswerSessionBody.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: zodErrorMessage(err as ZodError) }, 400)
  }

  const ok = sessions.provideAskUserAnswer(sessionId, body.answers)
  if (!ok) {
    // No pending resolver — the server likely restarted while awaiting input.
    // Fall back to resuming the session with the user's answers as the prompt.
    const formatted = Object.entries(body.answers)
      .map(([q, a]) => `${q}: ${a}`)
      .join("\n")
    const userSessionToken = getCookie(c, SESSION_COOKIE)
    const user = c.get("user")
    try {
      await sessions.resumeSessionQuery(sessionId, formatted, userSessionToken, user)
    } catch (err) {
      log.error("Failed to resume session after answer fallback", { sessionId, error: String(err) })
      return c.json({ error: "Failed to resume session" }, 500)
    }
  }
  return c.json({ ok: true })
})

sessionRoutes.post("/:id/resume", async (c) => {
  const sessionId = c.req.param("id")
  let body: ResumeSessionBody
  try {
    body = ResumeSessionBody.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: zodErrorMessage(err as ZodError) }, 400)
  }
  const { prompt } = body

  // Import agent-only session to DB if not already there (prevents FK constraint failure)
  if (!(await sessions.getSessionRecord(sessionId))) {
    const agentSession = await sessions.findAgentSession(sessionId)
    if (!agentSession) return c.json({ error: "Session not found" }, 404)
    await sessions.importAgentSession(sessionId, agentSession)
  }

  const userSessionToken = getCookie(c, SESSION_COOKIE)
  const user = c.get("user") as UserProfile | undefined
  const result = await sessions.resumeSessionQuery(sessionId, prompt, userSessionToken, user)
  if (!result.started) {
    return c.json({ error: "Session is already running" }, 409)
  }
  return c.json({ ok: true })
})

sessionRoutes.post("/:id/attach", async (c) => {
  const sessionId = c.req.param("id")
  let body: AttachToSessionBody
  try {
    body = AttachToSessionBody.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: zodErrorMessage(err as ZodError) }, 400)
  }
  const { type, id, title, content } = body

  let session = await sessions.getSessionRecord(sessionId)
  if (!session) {
    // Agent-only session (JSONL, not in DB) — import a minimal record first
    const agentSession = await sessions.findAgentSession(sessionId)
    if (!agentSession) {
      return c.json({ error: "Session not found" }, 404)
    }
    await sessions.importAgentSession(sessionId, agentSession)
  }

  await sessions.attachSourceToSession(sessionId, {
    type,
    id,
    title: title || `${type} ${id}`,
    content,
  })

  return c.json({ ok: true })
})

sessionRoutes.post("/:id/abort", async (c) => {
  const sessionId = c.req.param("id")
  const aborted = await sessions.abortRunningSession(sessionId)
  return c.json({ ok: aborted })
})

sessionRoutes.post("/:id/archive", async (c) => {
  const sessionId = c.req.param("id")
  let session = await sessions.getSessionRecord(sessionId)
  if (!session) {
    // Agent-only session (JSONL, not in DB) — import a minimal record first
    const agentSession = await sessions.findAgentSession(sessionId)
    if (!agentSession) {
      return c.json({ error: "Session not found" }, 404)
    }
    await sessions.importAgentSession(sessionId, agentSession)
  }
  const archived = await sessions.archiveSession(sessionId)
  return c.json({ ok: archived })
})

sessionRoutes.post("/:id/unarchive", async (c) => {
  const sessionId = c.req.param("id")
  const unarchived = await sessions.unarchiveSession(sessionId)
  if (!unarchived) {
    return c.json({ error: "Session not found or not archived" }, 404)
  }
  return c.json({ ok: true })
})

// --- Artifact code editing ---

sessionRoutes.patch("/:id/artifact", async (c) => {
  const sessionId = c.req.param("id")
  let body: PatchArtifactBody
  try {
    body = PatchArtifactBody.parse(await c.req.json())
  } catch (err) {
    return c.json({ error: zodErrorMessage(err as ZodError) }, 400)
  }
  const { toolUseId, code } = body
  const ok = await sessions.patchArtifactCode(sessionId, toolUseId, code)
  if (!ok) {
    log.warn("Artifact patch failed", { sessionId, toolUseId })
    return c.json({ error: "Artifact not found for the given tool_use id" }, 404)
  }
  return c.json({ ok: true })
})

// --- File upload / download ---

sessionRoutes.post("/:id/files", async (c) => {
  const sessionId = c.req.param("id")
  const body = await c.req.parseBody()
  const file = body["file"]
  if (!file || typeof file === "string") {
    return c.json({ error: "file field is required" }, 400)
  }
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const wsPath = c.get("workspace")?.path || sessions.getWorkspacePath()
  const result = saveSessionFile(wsPath, sessionId, file.name, buffer, file.type)
  return c.json(result)
})

const INLINE_MIME_PREFIXES = ["image/", "video/", "text/html", "image/svg+xml"]

sessionRoutes.get("/:id/files/:filename", async (c) => {
  const sessionId = c.req.param("id")
  const filename = decodeURIComponent(c.req.param("filename"))
  const absolutePath = c.req.query("path")

  // Reject filename containing path separators or traversal patterns
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return c.json({ error: "Invalid filename" }, 400)
  }

  let resolvedPath: string | null = null

  if (absolutePath) {
    const wsPath = c.get("workspace")?.path || sessions.getWorkspacePath() || process.cwd()
    const wsNorm = normalize(wsPath)
    const normalized = normalize(resolve(absolutePath))
    // Strict prefix check: resolved path must be inside workspace directory
    if (!normalized.startsWith(wsNorm + sep) && normalized !== wsNorm) {
      return c.json({ error: "Path outside workspace" }, 403)
    }
    // Additional check: reject if absolutePath itself contains traversal after normalization
    if (absolutePath.includes("..")) {
      return c.json({ error: "Path traversal not allowed" }, 403)
    }
    resolvedPath = normalized
  } else {
    const wsPath = c.get("workspace")?.path || sessions.getWorkspacePath()
    resolvedPath = getSessionFilePath(wsPath, sessionId, filename)
  }

  if (!resolvedPath) {
    return c.json({ error: "File not found" }, 404)
  }

  let data: Buffer
  try {
    data = readFileSync(resolvedPath)
  } catch {
    return c.json({ error: "File not found" }, 404)
  }

  const serveName = basename(resolvedPath)
  const mimeType = guessMimeType(serveName)
  c.header("Content-Type", mimeType)
  const isInline = INLINE_MIME_PREFIXES.some((t) => mimeType.startsWith(t))
  c.header("Content-Disposition", isInline ? `inline; filename="${serveName}"` : `attachment; filename="${serveName}"`)
  return c.body(new Uint8Array(data))
})

function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = {
    pdf: "application/pdf",
    json: "application/json",
    csv: "text/csv",
    txt: "text/plain",
    md: "text/markdown",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    ico: "image/x-icon",
    svg: "image/svg+xml",
    html: "text/html",
    htm: "text/html",
    mp4: "video/mp4",
    webm: "video/webm",
    ogg: "video/ogg",
    zip: "application/zip",
  }
  return map[ext] ?? "application/octet-stream"
}
