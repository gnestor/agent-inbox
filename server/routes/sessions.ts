import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { getCookie } from "hono/cookie"
import { readFileSync } from "fs"
import { resolve, normalize, basename, sep } from "path"
import { SESSION_COOKIE } from "./auth.js"
import * as sessions from "../lib/session-manager.js"
import { getSessionFilesDir, saveSessionFile, getSessionFilePath } from "../lib/session-files.js"

type UserProfile = { name: string; email: string; picture?: string }

export const sessionRoutes = new Hono()

sessionRoutes.post("/", async (c) => {
  const { prompt, linkedSourceType, linkedSourceId, linkedSourceContent } = await c.req.json()

  if (!prompt) {
    return c.json({ error: "prompt is required" }, 400)
  }

  const userSessionToken = getCookie(c, SESSION_COOKIE)

  try {
    const workspace = c.get("workspace")
    const sessionId = await sessions.startSession(prompt, {
      linkedSourceType,
      linkedSourceId,
      linkedSourceContent,
      triggerSource: "manual",
      userSessionToken,
      workspacePath: workspace?.path,
    })
    return c.json({ sessionId })
  } catch (err: any) {
    console.error("Failed to start session:", err)
    return c.json({ error: err.message || "Failed to start session" }, 500)
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
    console.error("listAllAgentSessions failed:", err)
    return [] as Awaited<ReturnType<typeof sessions.listAllAgentSessions>>
  })

  // Enrich with DB metadata (status overrides, summaries, linked items)
  const dbRecords = new Map<string, Record<string, unknown>>()
  if (agentSessions.length > 0) {
    const allDbSessions = await sessions.listSessionRecords({ q: q || undefined })
    for (const s of allDbSessions) {
      dbRecords.set(s.id as string, s)
    }
  }

  let results = agentSessions.map((s) => {
    const db = dbRecords.get(s.sessionId)
    // DB record takes priority for status, summary, and linked items
    if (db) {
      return {
        id: s.sessionId,
        status: db.status as string,
        prompt: (db.prompt as string) || s.firstPrompt || "",
        summary: (db.summary as string) || s.summary || s.firstPrompt || null,
        startedAt: (db.started_at as string) || new Date(s.lastModified).toISOString(),
        updatedAt: (db.updated_at as string) || new Date(s.lastModified).toISOString(),
        completedAt: (db.completed_at as string) || null,
        linkedSourceType: (db.linked_source_type as string) || null,
        linkedSourceId: (db.linked_source_id as string) || null,
        triggerSource: (db.trigger_source as string) || "manual",
        project: s.project,
        linkedItemTitle: (db.linked_item_title as string) || null,
      }
    }
    return {
      id: s.sessionId,
      status: "complete" as const,
      prompt: s.firstPrompt || "",
      summary: s.summary || s.firstPrompt || null,
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

  // Apply status filter
  if (status) {
    const statuses = status.split(",")
    results = results.filter((s) => statuses.includes(s.status))
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
    // JSONL is the source of truth for session transcript
    const agentSession = await sessions.findAgentSession(sessionId)
    const messages = agentSession
      ? await sessions.getAgentSessionTranscript(sessionId, agentSession.cwd)
      : []

    return c.json({
      session: {
        id: session.id,
        status: session.status,
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
  const transcript = await sessions.getAgentSessionTranscript(sessionId, agentSession.cwd)

  return c.json({
    session: {
      id: agentSession.sessionId,
      status: "complete",
      prompt: agentSession.firstPrompt || "",
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
  const { summary } = await c.req.json()

  if (typeof summary !== "string") {
    return c.json({ error: "summary must be a string" }, 400)
  }

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
  const { answers } = await c.req.json()

  if (!answers || typeof answers !== "object") {
    return c.json({ error: "answers object is required" }, 400)
  }

  const ok = sessions.provideAskUserAnswer(sessionId, answers as Record<string, string>)
  if (!ok) {
    // No pending resolver — the server likely restarted while awaiting input.
    // Fall back to resuming the session with the user's answers as the prompt.
    const formatted = Object.entries(answers as Record<string, string>)
      .map(([q, a]) => `${q}: ${a}`)
      .join("\n")
    const userSessionToken = getCookie(c, SESSION_COOKIE)
    const user = c.get("user") as UserProfile | undefined
    try {
      await sessions.resumeSessionQuery(sessionId, formatted, userSessionToken, user)
    } catch (err: any) {
      console.error("Failed to resume session after answer fallback:", err)
      return c.json({ error: "Failed to resume session" }, 500)
    }
  }
  return c.json({ ok: true })
})

sessionRoutes.post("/:id/resume", async (c) => {
  const sessionId = c.req.param("id")
  const { prompt } = await c.req.json()

  if (!prompt) {
    return c.json({ error: "prompt is required" }, 400)
  }

  // Import agent-only session to DB if not already there (prevents FK constraint failure)
  if (!(await sessions.getSessionRecord(sessionId))) {
    const { getAgentSession } = await import("../lib/session-files.js")
    const agentSession = getAgentSession(sessionId)
    if (!agentSession) return c.json({ error: "Session not found" }, 404)
    await sessions.importAgentSession(sessionId, agentSession)
  }

  const userSessionToken = getCookie(c, SESSION_COOKIE)
  const user = c.get("user") as UserProfile | undefined
  await sessions.resumeSessionQuery(sessionId, prompt, userSessionToken, user)
  return c.json({ ok: true })
})

sessionRoutes.post("/:id/attach", async (c) => {
  const sessionId = c.req.param("id")
  const { type, id, title, content } = await c.req.json()

  if (!type || !id || !content) {
    return c.json({ error: "type, id, and content are required" }, 400)
  }

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

sessionRoutes.get("/:id/stream", async (c) => {
  const sessionId = c.req.param("id")
  const user = c.get("user") as UserProfile | undefined

  return streamSSE(c, async (stream) => {
    const send = (data: string) => {
      stream.writeSSE({ data, event: "message" })
    }

    await sessions.addSseClient(sessionId, send)
    if (user) sessions.addPresenceUser(sessionId, user)

    // Keep connection alive
    const keepAlive = setInterval(() => {
      stream.writeSSE({ data: "", event: "ping" })
    }, 15_000)

    // Wait for client disconnect
    try {
      await new Promise((resolve) => {
        stream.onAbort(() => resolve(undefined))
      })
    } finally {
      clearInterval(keepAlive)
      sessions.removeSseClient(sessionId, send)
      if (user) sessions.removePresenceUser(sessionId, user.email)
    }
  })
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
  const { sequence, code } = await c.req.json()
  if (typeof sequence !== "number" || typeof code !== "string") {
    return c.json({ error: "sequence (number) and code (string) are required" }, 400)
  }
  const ok = await sessions.patchArtifactCode(sessionId, sequence, code)
  if (!ok) {
    console.warn(`[artifact patch] Failed for session=${sessionId} sequence=${sequence}`)
    return c.json({ error: "Artifact not found at the given sequence" }, 404)
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

  let resolvedPath: string | null = null

  if (absolutePath) {
    const wsPath = c.get("workspace")?.path || sessions.getWorkspacePath() || process.cwd()
    const wsNorm = normalize(wsPath)
    const normalized = normalize(resolve(absolutePath))
    if (!normalized.startsWith(wsNorm + sep) && normalized !== wsNorm) {
      return c.json({ error: "Path outside workspace" }, 403)
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
  return c.body(data)
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
