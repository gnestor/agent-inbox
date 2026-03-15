import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import * as sessions from "../lib/session-manager.js"

export const sessionRoutes = new Hono()

sessionRoutes.post("/", async (c) => {
  const { prompt, linkedEmailId, linkedEmailThreadId, linkedTaskId } = await c.req.json()

  if (!prompt) {
    return c.json({ error: "prompt is required" }, 400)
  }

  try {
    const sessionId = await sessions.startSession(prompt, {
      linkedEmailId,
      linkedEmailThreadId,
      linkedTaskId,
      triggerSource: "manual",
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

  const currentProject = sessions.projectLabel(sessions.getWorkspacePath())

  // Merge: DB sessions take priority, add any agent sessions not in DB
  // Default to current workspace project; explicit project filter overrides
  const dbIds = new Set(dbSessions.map((s) => s.id))
  const projectsFilter = project ? project.split(",") : [currentProject]
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
    const messages = sessions.getSessionMessages(sessionId)
    return c.json({
      session: {
        id: session.id,
        status: session.status,
        prompt: session.prompt,
        summary: session.summary,
        startedAt: session.started_at,
        updatedAt: session.updated_at,
        completedAt: session.completed_at,
        messageCount: session.message_count,
        linkedEmailId: session.linked_email_id,
        linkedEmailThreadId: session.linked_email_thread_id,
        linkedTaskId: session.linked_task_id,
        triggerSource: session.trigger_source,
        project: sessions.projectLabel(sessions.getWorkspacePath()),
      },
      messages: messages.map((m) => ({
        id: m.id,
        sessionId: m.session_id,
        sequence: m.sequence,
        type: m.type,
        message: JSON.parse(m.message as string),
        createdAt: m.created_at,
      })),
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

  const session = sessions.getSessionRecord(sessionId)
  if (!session) {
    return c.json({ error: "Session not found" }, 404)
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

  await sessions.resumeSessionQuery(sessionId, prompt)
  return c.json({ ok: true })
})

sessionRoutes.get("/:id/stream", async (c) => {
  const sessionId = c.req.param("id")

  return streamSSE(c, async (stream) => {
    const send = (data: string) => {
      stream.writeSSE({ data, event: "message" })
    }

    sessions.addSseClient(sessionId, send)

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
    }
  })
})

sessionRoutes.post("/:id/abort", async (c) => {
  const sessionId = c.req.param("id")
  const aborted = sessions.abortRunningSession(sessionId)
  return c.json({ ok: aborted })
})
