import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { getCookie } from "hono/cookie"
import { SESSION_COOKIE } from "./auth.js"
import * as sessions from "../lib/session-manager.js"
import { getSessionFilesDir, saveSessionFile, getSessionFilePath } from "../lib/session-files.js"

type UserProfile = { name: string; email: string; picture?: string }

export const sessionRoutes = new Hono()

sessionRoutes.post("/", async (c) => {
  const { prompt, linkedEmailId, linkedEmailThreadId, linkedTaskId } = await c.req.json()

  if (!prompt) {
    return c.json({ error: "prompt is required" }, 400)
  }

  const userSessionToken = getCookie(c, SESSION_COOKIE)

  try {
    const sessionId = await sessions.startSession(prompt, {
      linkedEmailId,
      linkedEmailThreadId,
      linkedTaskId,
      triggerSource: "manual",
      userSessionToken,
    })
    return c.json({ sessionId })
  } catch (err: any) {
    console.error("Failed to start session:", err)
    return c.json({ error: err.message || "Failed to start session" }, 500)
  }
})

sessionRoutes.get("/", async (c) => {
  const status = c.req.query("status")
  const triggerSource = c.req.query("trigger_source")
  const project = c.req.query("project")
  const q = c.req.query("q")

  // Get sessions from local DB
  const dbSessions = sessions.listSessionRecords({
    status: status || undefined,
    triggerSource: triggerSource || undefined,
    q: q || undefined,
  })

  // Also get sessions from Agent SDK (discovers CC sessions not started by us).
  // When searching, use searchAgentSessions which scans raw JSONL content rather
  // than the truncated firstPrompt metadata so deep-in-prompt terms are found.
  const agentSessions = await (q
    ? sessions.searchAgentSessions(q)
    : sessions.listAllAgentSessions()
  ).catch((err: unknown) => {
    console.error("listAllAgentSessions failed:", err)
    return [] as Awaited<ReturnType<typeof sessions.listAllAgentSessions>>
  })

  // Match sessions from both the git repo name (e.g., "hammies-agent") and
  // the directory basename (e.g., "agent") to handle workspace path changes
  const workspaceName = sessions.getWorkspaceName()
  const dirName = sessions.projectLabel(sessions.getWorkspacePath())
  const currentProject = workspaceName || dirName

  // Merge: DB sessions take priority, add any agent sessions not in DB
  // Default to current workspace project; explicit project filter overrides
  //
  // IMPORTANT: build dbIds from ALL DB sessions (ignoring the status filter) so
  // that agent SDK sessions don't "resurrect" as "complete" when their DB
  // counterpart is filtered out by status (e.g. filtering out "archived").
  const allDbIds = status
    ? new Set(sessions.listSessionRecords({ q: q || undefined }).map((s) => s.id as string))
    : new Set(dbSessions.map((s) => s.id as string))
  const dbIds = allDbIds
  const defaultProjects = new Set([currentProject, dirName])
  if (workspaceName) defaultProjects.add(workspaceName)
  const projectsFilter = project ? project.split(",") : [...defaultProjects]
  let merged = [
    ...dbSessions.map((s) => ({
      id: s.id as string,
      status: s.status as string,
      prompt: s.prompt as string,
      summary: (s.summary as string) || null,
      startedAt: s.started_at as string,
      updatedAt: s.updated_at as string,
      completedAt: (s.completed_at as string) || null,
      messageCount: s.message_count as number,
      linkedEmailId: (s.linked_email_id as string) || null,
      linkedEmailThreadId: (s.linked_email_thread_id as string) || null,
      linkedTaskId: (s.linked_task_id as string) || null,
      triggerSource: (s.trigger_source as string) || "manual",
      project: currentProject,
      linkedItemTitle:
        (s.linked_email_subject as string) || (s.linked_task_title as string) || null,
    })),
    ...agentSessions
      .filter((s) => projectsFilter.includes(s.project))
      .filter((s) => !dbIds.has(s.sessionId))
      .filter(() => !status || status.split(",").includes("complete"))
      .map((s) => ({
        id: s.sessionId,
        status: "complete" as const,
        prompt: s.firstPrompt || "",
        summary: s.summary || s.firstPrompt || null,
        startedAt: new Date(s.lastModified).toISOString(),
        updatedAt: new Date(s.lastModified).toISOString(),
        completedAt: new Date(s.lastModified).toISOString(),
        messageCount: 0,
        linkedEmailId: null,
        linkedEmailThreadId: null,
        linkedTaskId: null,
        triggerSource: "manual" as const,
        project: s.project,
      })),
  ]

  // Deduplicate by id (DB sessions take priority since they appear first)
  const seenIds = new Set<string>()
  merged = merged.filter((s) => {
    if (seenIds.has(s.id)) return false
    seenIds.add(s.id)
    return true
  })

  // Sort by most recently updated
  merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  return c.json({ sessions: merged })
})

sessionRoutes.get("/projects", async (c) => {
  const projects = await sessions.listProjectOptions()
  return c.json({ projects })
})

sessionRoutes.get("/linked", async (c) => {
  const threadId = c.req.query("threadId")
  const taskId = c.req.query("taskId")
  const session = sessions.getLinkedSession(threadId, taskId)
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
  const session = sessions.getSessionRecord(sessionId)

  if (session) {
    const dbMessages = sessions.getSessionMessages(sessionId)

    // If the session was imported (e.g., via attach or rename) it may only have
    // system messages (attached_context) in the DB. Fall back to the JSONL
    // transcript for the actual conversation, prepending any DB-only messages.
    const parsedDbMessages = dbMessages.map((m) => ({
      id: m.id,
      sessionId: m.session_id,
      sequence: m.sequence,
      type: m.type,
      message: JSON.parse(m.message as string),
      createdAt: m.created_at,
    }))
    const hasConversation = parsedDbMessages.some(
      (m) => m.type !== "system" || m.message?.subtype !== "attached_context",
    )
    let messages: Array<Record<string, unknown>>
    if (hasConversation) {
      messages = parsedDbMessages
    } else {
      const agentSession = await sessions.findAgentSession(sessionId)
      const transcript = agentSession
        ? await sessions.getAgentSessionTranscript(sessionId, agentSession.cwd)
        : []
      // Prepend any attached context messages before the transcript
      messages = [...parsedDbMessages, ...transcript]
    }

    return c.json({
      session: {
        id: session.id,
        status: session.status,
        prompt: session.prompt,
        summary: session.summary,
        startedAt: session.started_at,
        updatedAt: session.updated_at,
        completedAt: session.completed_at,
        messageCount: session.message_count || messages.length,
        linkedEmailId: session.linked_email_id,
        linkedEmailThreadId: session.linked_email_thread_id,
        linkedTaskId: session.linked_task_id,
        triggerSource: session.trigger_source,
        project: sessions.projectLabel(sessions.getWorkspacePath()),
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
      messageCount: transcript.length,
      linkedEmailId: null,
      linkedEmailThreadId: null,
      linkedTaskId: null,
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

  let session = sessions.getSessionRecord(sessionId)
  if (!session) {
    // Agent-only session (JSONL, not in DB) — import a minimal completed record
    const agentSession = await sessions.findAgentSession(sessionId)
    if (!agentSession) {
      return c.json({ error: "Session not found" }, 404)
    }
    sessions.importAgentSession(sessionId, agentSession)
  }

  sessions.updateSessionSummary(sessionId, summary.slice(0, 200))
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
    return c.json({ error: "No pending question for this session" }, 404)
  }
  return c.json({ ok: true })
})

sessionRoutes.post("/:id/resume", async (c) => {
  const sessionId = c.req.param("id")
  const { prompt } = await c.req.json()

  if (!prompt) {
    return c.json({ error: "prompt is required" }, 400)
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

  let session = sessions.getSessionRecord(sessionId)
  if (!session) {
    // Agent-only session (JSONL, not in DB) — import a minimal record first
    const agentSession = await sessions.findAgentSession(sessionId)
    if (!agentSession) {
      return c.json({ error: "Session not found" }, 404)
    }
    sessions.importAgentSession(sessionId, agentSession)
  }

  sessions.attachSourceToSession(sessionId, {
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

    sessions.addSseClient(sessionId, send)
    if (user) sessions.addPresenceUser(sessionId, user)

    // Send existing messages first for catch-up
    const existing = sessions.getSessionMessages(sessionId)
    for (const msg of existing) {
      await stream.writeSSE({
        data: JSON.stringify({
          sequence: msg.sequence,
          message: JSON.parse(msg.message as string),
        }),
        event: "message",
      })
    }

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
  const aborted = sessions.abortRunningSession(sessionId)
  return c.json({ ok: aborted })
})

sessionRoutes.post("/:id/archive", async (c) => {
  const sessionId = c.req.param("id")
  let session = sessions.getSessionRecord(sessionId)
  if (!session) {
    // Agent-only session (JSONL, not in DB) — import a minimal record first
    const agentSession = await sessions.findAgentSession(sessionId)
    if (!agentSession) {
      return c.json({ error: "Session not found" }, 404)
    }
    sessions.importAgentSession(sessionId, agentSession)
  }
  const archived = sessions.archiveSession(sessionId)
  return c.json({ ok: archived })
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
  const result = await saveSessionFile(sessionId, file.name, buffer, file.type)
  return c.json(result)
})

sessionRoutes.get("/:id/files/:filename", async (c) => {
  const sessionId = c.req.param("id")
  const filename = decodeURIComponent(c.req.param("filename"))
  const filePath = await getSessionFilePath(sessionId, filename)
  if (!filePath) {
    return c.json({ error: "File not found" }, 404)
  }
  const fs = await import("fs")
  if (!fs.existsSync(filePath)) {
    return c.json({ error: "File not found" }, 404)
  }
  const data = fs.readFileSync(filePath)
  // Use a basic mime-type lookup
  const mimeType = guessMimeType(filename)
  c.header("Content-Type", mimeType)
  c.header("Content-Disposition", `attachment; filename="${filename}"`)
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
    svg: "image/svg+xml",
    html: "text/html",
    zip: "application/zip",
  }
  return map[ext] ?? "application/octet-stream"
}
