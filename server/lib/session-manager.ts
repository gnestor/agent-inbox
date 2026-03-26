import { execFileSync } from "child_process"
import { resolve } from "path"

const INITIAL_SUMMARY_LENGTH = 80
import { getDb } from "../db/schema.js"
import { getAgentEnv } from "./credentials.js"
import { generateSessionTitle } from "./title-generator.js"
import type { CredentialProxy } from "./credential-proxy.js"
import { buildRenderOutputMcpServer } from "./render-output-tool.js"

let credentialProxy: CredentialProxy | null = null

export function setCredentialProxy(proxy: CredentialProxy) {
  credentialProxy = proxy
}

// Store active SSE clients per session
const sseClients = new Map<string, Set<(data: string) => void>>()

// Store abort controllers for running sessions
const runningQueries = new Map<string, AbortController>()

// Pending AskUserQuestion answers: sessionId → resolver function
const pendingQuestions = new Map<string, (answers: Record<string, string>) => void>()

// Provide an answer to a pending AskUserQuestion. Returns true if a question was waiting.
export function provideAskUserAnswer(sessionId: string, answers: Record<string, string>): boolean {
  const resolver = pendingQuestions.get(sessionId)
  if (!resolver) return false
  pendingQuestions.delete(sessionId)
  resolver(answers)
  return true
}

// Build a canUseTool callback that intercepts AskUserQuestion and waits for user answers.
// getSessionId is a thunk because in startSession the ID isn't known until the init message.
function makeCanUseTool(getSessionId: () => string | null) {
  return async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<{ behavior: "allow"; updatedInput?: Record<string, unknown> }> => {
    if (toolName === "AskUserQuestion") {
      const sessionId = getSessionId()
      if (sessionId) {
        if (process.env.NODE_ENV !== "production") {
          console.log(`[session:${sessionId}] ask_user:`, input.questions)
        }
        updateSessionStatus(sessionId, "awaiting_user_input")
        broadcastToSession(sessionId, { type: "ask_user_question", questions: input.questions })

        const answers = await new Promise<Record<string, string>>((resolve) => {
          pendingQuestions.set(sessionId, resolve)
        })

        if (process.env.NODE_ENV !== "production") {
          console.log(`[session:${sessionId}] user_answered:`, Object.keys(answers))
        }
        updateSessionStatus(sessionId, "running")
        return { behavior: "allow", updatedInput: { ...input, answers } }
      }
    }
    return { behavior: "allow" }
  }
}

// Build env for agent, excluding sensitive keys. When the credential proxy
// is running, route traffic through it instead of passing raw API tokens.
function buildAgentEnv(userSessionToken?: string): Record<string, string> {
  const env: Record<string, string> = {}

  // Base env: inherit process env minus sensitive keys
  const excluded = new Set([
    "ANTHROPIC_API_KEY", "CLAUDECODE",
    // Exclude raw API tokens — the proxy injects these
    "NOTION_API_TOKEN", "GOOGLE_REFRESH_TOKEN", "GOOGLE_CLIENT_SECRET",
    "SLACK_BOT_TOKEN", "SHOPIFY_ACCESS_TOKEN", "GITHUB_TOKEN",
    "VAULT_SECRET",
  ])
  for (const [k, v] of Object.entries(process.env)) {
    if (!excluded.has(k) && v !== undefined) {
      env[k] = v
    }
  }

  // If the credential proxy is running, route traffic through it
  if (credentialProxy && userSessionToken) {
    Object.assign(env, credentialProxy.getProxyEnv(userSessionToken))
  } else {
    // Fallback: pass workspace credentials directly (pre-proxy migration)
    Object.assign(env, getAgentEnv())
  }

  return env
}

let workspacePath = ""
let workspaceName = ""
let workflowPluginPath = ""

export function setWorkspacePath(path: string) {
  workspacePath = resolve(path)
  workflowPluginPath = resolve(workspacePath, "../workflow-plugin")
  // Derive workspace name from git remote (repo name), fallback to dir basename
  try {
    const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], { cwd: path, encoding: "utf-8" }).trim()
    // https://github.com/user/repo-name.git → repo-name
    workspaceName = remoteUrl.replace(/\.git$/, "").split("/").pop() || path.split("/").pop() || path
  } catch {
    workspaceName = path.split("/").pop() || path
  }
}

export function getWorkspacePath() {
  return workspacePath
}

/** Workspace name derived from git repo name (e.g., "hammies-agent") */
export function getWorkspaceName() {
  return workspaceName
}

export async function createSessionRecord(
  sessionId: string,
  prompt: string,
  options?: {
    linkedEmailId?: string
    linkedEmailThreadId?: string
    linkedTaskId?: string
    linkedSourceType?: string
    linkedSourceId?: string
    triggerSource?: string
    linkedItemTitle?: string
  },
) {
  const db = getDb()
  const now = new Date().toISOString()
  const metadata = options?.linkedItemTitle
    ? JSON.stringify({ linkedItemTitle: options.linkedItemTitle })
    : null

  // Derive generic linked_source_type/id from legacy fields if not provided
  const sourceType = options?.linkedSourceType
    ?? (options?.linkedEmailThreadId ? "gmail" : options?.linkedTaskId ? "notion-tasks" : null)
  const sourceId = options?.linkedSourceId
    ?? options?.linkedEmailThreadId ?? options?.linkedTaskId ?? null

  db.prepare(
    `INSERT INTO sessions (id, status, prompt, summary, started_at, updated_at, linked_email_id, linked_email_thread_id, linked_task_id, linked_source_type, linked_source_id, trigger_source, metadata)
     VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    prompt,
    prompt.slice(0, INITIAL_SUMMARY_LENGTH),
    now,
    now,
    options?.linkedEmailId || null,
    options?.linkedEmailThreadId || null,
    options?.linkedTaskId || null,
    sourceType,
    sourceId,
    options?.triggerSource || "manual",
    metadata,
  )
}

/** Extract the questions array from the last AskUserQuestion tool_use in the session transcript.
 *  Uses a targeted query (last 10 assistant messages) instead of loading the full transcript. */
export function getLastAskUserQuestions(sessionId: string): unknown[] | null {
  const db = getDb()
  const rows = db
    .prepare(
      "SELECT message FROM session_messages WHERE session_id = ? AND type = 'assistant' ORDER BY sequence DESC LIMIT 10",
    )
    .all(sessionId) as Array<{ message: string }>
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.message)
      const content = parsed?.message?.content ?? parsed?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type === "tool_use" && block.name === "AskUserQuestion" && block.input?.questions) {
          return block.input.questions
        }
      }
    } catch {}
  }
  return null
}

export function appendSessionMessage(
  sessionId: string,
  sequence: number,
  type: string,
  message: unknown,
) {
  const db = getDb()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT OR IGNORE INTO session_messages (session_id, sequence, type, message, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionId, sequence, type, JSON.stringify(message), now)

  db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(
    now,
    sessionId,
  )
}

export function updateSessionStatus(sessionId: string, status: string, summary?: string) {
  const db = getDb()
  const now = new Date().toISOString()

  if (status === "complete" || status === "errored") {
    // Don't overwrite archived status with terminal stream states (race condition guard)
    const current = db.prepare("SELECT status FROM sessions WHERE id = ?").get(sessionId) as
      | { status: string }
      | undefined
    if (current?.status === "archived") {
      if (process.env.NODE_ENV !== "production") {
        console.log(`[session:${sessionId}] status change blocked: archived → ${status}`)
      }
      return
    }
    if (process.env.NODE_ENV !== "production") {
      console.log(`[session:${sessionId}] ${current?.status ?? "unknown"} → ${status}`)
    }

    db.prepare(
      `UPDATE sessions SET status = ?, summary = COALESCE(?, summary), completed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(status, summary || null, now, now, sessionId)
  } else {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[session:${sessionId}] → ${status}`)
    }
    db.prepare(
      `UPDATE sessions SET status = ?, summary = COALESCE(?, summary), updated_at = ? WHERE id = ?`,
    ).run(status, summary || null, now, sessionId)
  }
}

export function archiveSession(sessionId: string): boolean {
  const session = getSessionRecord(sessionId)
  if (!session) return false

  // Abort if running (without calling abortRunningSession which would set status to "complete")
  const controller = runningQueries.get(sessionId)
  if (controller) {
    controller.abort()
    runningQueries.delete(sessionId)
    pendingQuestions.delete(sessionId)
  }

  updateSessionStatus(sessionId, "archived")
  return true
}

export function unarchiveSession(sessionId: string): boolean {
  const db = getDb()
  const now = new Date().toISOString()
  const result = db.prepare(
    `UPDATE sessions SET status = 'complete', updated_at = ? WHERE id = ? AND status = 'archived'`,
  ).run(now, sessionId)
  return result.changes > 0
}

/** Import an agent-only session (JSONL) into the DB as a completed record. */
export function importAgentSession(
  sessionId: string,
  agentSession: { firstPrompt?: string | null; summary?: string | null; lastModified: number }
) {
  const db = getDb()
  const ts = new Date(agentSession.lastModified).toISOString()
  db.prepare(
    `INSERT OR IGNORE INTO sessions (id, status, prompt, summary, started_at, updated_at, completed_at, trigger_source)
     VALUES (?, 'complete', ?, ?, ?, ?, ?, 'manual')`
  ).run(
    sessionId,
    agentSession.firstPrompt || "",
    (agentSession.summary || agentSession.firstPrompt || "").slice(0, 200),
    ts,
    ts,
    ts,
  )
}

export function updateSessionSummary(sessionId: string, summary: string) {
  const db = getDb()
  db.prepare("UPDATE sessions SET summary = ?, updated_at = ? WHERE id = ?")
    .run(summary, new Date().toISOString(), sessionId)
}

export function getSessionRecord(sessionId: string) {
  const db = getDb()
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as
    | Record<string, unknown>
    | undefined
}

export function getSessionMessages(sessionId: string) {
  const db = getDb()
  return db
    .prepare("SELECT * FROM session_messages WHERE session_id = ? ORDER BY sequence")
    .all(sessionId) as Array<Record<string, unknown>>
}

export function getLinkedSession(
  linkedEmailThreadId?: string,
  linkedTaskId?: string,
  linkedSourceType?: string,
  linkedSourceId?: string,
): Record<string, unknown> | undefined {
  const db = getDb()
  // Prefer generic linked_source_type/id
  const srcType = linkedSourceType ?? (linkedEmailThreadId ? "gmail" : linkedTaskId ? "notion-tasks" : undefined)
  const srcId = linkedSourceId ?? linkedEmailThreadId ?? linkedTaskId
  if (srcType && srcId) {
    const result = db
      .prepare(
        "SELECT * FROM sessions WHERE linked_source_type = ? AND linked_source_id = ? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(srcType, srcId) as Record<string, unknown> | undefined
    if (result) return result
  }
  // Fallback: check legacy columns for backward compat
  if (linkedEmailThreadId) {
    return db
      .prepare(
        "SELECT * FROM sessions WHERE linked_email_thread_id = ? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(linkedEmailThreadId) as Record<string, unknown> | undefined
  }
  if (linkedTaskId) {
    return db
      .prepare(
        "SELECT * FROM sessions WHERE linked_task_id = ? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(linkedTaskId) as Record<string, unknown> | undefined
  }
  return undefined
}

export function listSessionRecords(filters?: {
  status?: string
  triggerSource?: string
  q?: string
}) {
  const db = getDb()
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters?.status) {
    const values = filters.status.split(",")
    if (values.length === 1) {
      conditions.push("s.status = ?")
      params.push(values[0])
    } else {
      conditions.push(`s.status IN (${values.map(() => "?").join(",")})`)
      params.push(...values)
    }
  }
  if (filters?.triggerSource) {
    conditions.push("s.trigger_source = ?")
    params.push(filters.triggerSource)
  }

  let sql: string
  if (filters?.q) {
    const like = `%${filters.q}%`
    // Join session_messages to search full message content
    sql = `SELECT DISTINCT s.*, json_extract(s.metadata, '$.linkedItemTitle') AS linked_item_title FROM sessions s LEFT JOIN session_messages sm ON sm.session_id = s.id`
    conditions.push("(s.prompt LIKE ? OR s.summary LIKE ? OR sm.message LIKE ?)")
    params.push(like, like, like)
  } else {
    sql = "SELECT s.*, json_extract(s.metadata, '$.linkedItemTitle') AS linked_item_title FROM sessions s"
  }

  if (conditions.length) {
    sql += " WHERE " + conditions.join(" AND ")
  }
  sql += " ORDER BY s.updated_at DESC"

  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>
}

// In-memory presence map: sessionId → Map<email, user>
const sessionPresence = new Map<string, Map<string, { name: string; email: string; picture?: string }>>()

export function addPresenceUser(sessionId: string, user: { name: string; email: string; picture?: string }) {
  let users = sessionPresence.get(sessionId)
  if (!users) { users = new Map(); sessionPresence.set(sessionId, users) }
  users.set(user.email, user)
  broadcastToSession(sessionId, { type: "presence", users: getPresenceUsers(sessionId) })
}

export function removePresenceUser(sessionId: string, email: string) {
  const users = sessionPresence.get(sessionId)
  if (!users) return
  users.delete(email)
  if (users.size === 0) sessionPresence.delete(sessionId)
  broadcastToSession(sessionId, { type: "presence", users: getPresenceUsers(sessionId) })
}

export function getPresenceUsers(sessionId: string) {
  return Array.from(sessionPresence.get(sessionId)?.values() ?? [])
}

// SSE client management
export function addSseClient(sessionId: string, send: (data: string) => void) {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set())
  }
  sseClients.get(sessionId)!.add(send)
  if (process.env.NODE_ENV !== "production") {
    console.log(`[sse:${sessionId}] client connected (${sseClients.get(sessionId)!.size} total)`)
  }

  // Re-deliver the last AskUserQuestion when the session is awaiting input.
  // The original broadcast may have fired before any browser was connected
  // (e.g. agent resumed on startup and hit AskUserQuestion before the user opened the page).
  const session = getSessionRecord(sessionId)
  if (session?.status === "awaiting_user_input") {
    const questions = getLastAskUserQuestions(sessionId)
    if (questions) {
      send(JSON.stringify({ type: "ask_user_question", questions }))
    }
  }
}

export function removeSseClient(sessionId: string, send: (data: string) => void) {
  sseClients.get(sessionId)?.delete(send)
  const remaining = sseClients.get(sessionId)?.size ?? 0
  if (process.env.NODE_ENV !== "production") {
    console.log(`[sse:${sessionId}] client disconnected (${remaining} remaining)`)
  }
  if (remaining === 0) {
    sseClients.delete(sessionId)
  }
}

export function broadcastToSession(sessionId: string, data: unknown) {
  const clients = sseClients.get(sessionId)
  if (!clients) return
  // if (process.env.NODE_ENV !== "production") {
  //   const d = data as Record<string, unknown>
  //   console.log(`[sse:${sessionId}] → ${d.type ?? `seq:${d.sequence}`} (${clients.size} client${clients.size === 1 ? "" : "s"})`)
  // }
  const json = JSON.stringify(data)
  for (const send of clients) {
    send(json)
  }
}

async function autoNameSession(sessionId: string) {
  try {
    const session = getSessionRecord(sessionId)
    if (!session) return

    // Skip if user has manually renamed the session
    const initialSummary = (session.prompt as string).slice(0, INITIAL_SUMMARY_LENGTH)
    if (session.summary !== initialSummary) return

    const messages = getSessionMessages(sessionId)
    if (messages.length < 2) return // Skip trivial sessions (e.g. immediate errors)

    const title = await generateSessionTitle(
      messages.map((m) => ({ type: m.type as string, message: m.message as string }))
    )
    if (title) {
      updateSessionSummary(sessionId, title)
    }
  } catch (err) {
    console.error("Auto-naming failed for session", sessionId, err)
  }
}

function buildSourceContext(
  emailThreadId?: string | null,
  emailId?: string | null,
  taskId?: string | null,
  sourceType?: string | null,
  sourceId?: string | null,
): string | null {
  if (emailThreadId) {
    return `Source context: Email thread ${emailThreadId}` +
      (emailId ? ` (message: ${emailId})` : "")
  }
  if (taskId) return `Source context: Notion task ${taskId}`
  if (sourceType && sourceId) return `Source context: ${sourceType} item ${sourceId}`
  return null
}

// Session execution using Agent SDK
export async function startSession(
  prompt: string,
  options?: {
    linkedEmailId?: string
    linkedEmailThreadId?: string
    linkedTaskId?: string
    linkedSourceType?: string
    linkedSourceId?: string
    triggerSource?: string
    userSessionToken?: string
  },
): Promise<string> {
  // Dynamic import to avoid issues at startup
  const { query } = await import("@anthropic-ai/claude-agent-sdk")

  const abortController = new AbortController()
  let sessionId: string | null = null

  const sourceContext = buildSourceContext(
    options?.linkedEmailThreadId, options?.linkedEmailId, options?.linkedTaskId,
    options?.linkedSourceType, options?.linkedSourceId,
  )

  const q = query({
    prompt,
    options: {
      cwd: workspacePath,
      systemPrompt: { type: "preset", preset: "claude_code" },
      settingSources: ["project"],
      allowedTools: ["Read", "Grep", "Glob", "Bash", "Write", "Edit"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      abortController,
      env: buildAgentEnv(options?.userSessionToken),
      canUseTool: makeCanUseTool(() => sessionId),
      plugins: [
        { type: "local" as const, path: workflowPluginPath },
      ],
      mcpServers: {
        render_output: buildRenderOutputMcpServer(),
      },
    },
  })
  let sequence = 0

  // Process messages in background
  ;(async () => {
    try {
      for await (const message of q) {
        // Capture session ID from init message
        if ((message as any).type === "system" && (message as any).subtype === "init") {
          sessionId = (message as any).session_id

          await createSessionRecord(sessionId!, prompt, options)
          runningQueries.set(sessionId!, abortController)
        }

        if (sessionId) {
          appendSessionMessage(sessionId, sequence, (message as any).type || "unknown", message)
          broadcastToSession(sessionId, { sequence, message })
          sequence++
        }

        // Check for result message (session complete)
        if ("result" in (message as any)) {
          if (sessionId) {
            updateSessionStatus(sessionId, "complete")
            broadcastToSession(sessionId, {
              type: "session_complete",
              status: "complete",
            })
          }
        }
      }

      if (sessionId) {
        updateSessionStatus(sessionId, "complete")
        autoNameSession(sessionId).catch(() => {})
        runningQueries.delete(sessionId)
      }
    } catch (err: any) {
      console.error("Session error:", err)
      if (sessionId) {
        updateSessionStatus(sessionId, "errored", err.message)
        broadcastToSession(sessionId, {
          type: "session_error",
          error: err.message,
        })
        runningQueries.delete(sessionId)
      }
    }
  })()

  // Wait for session ID from init message
  const maxWait = 15_000
  const start = Date.now()
  while (!sessionId && Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 100))
  }

  if (!sessionId) {
    throw new Error("Timed out waiting for session ID")
  }

  return sessionId
}

export async function resumeSessionQuery(
  sessionId: string,
  prompt: string,
  userSessionToken?: string,
  userProfile?: { name: string; email: string; picture?: string },
): Promise<void> {
  // Guard against double-resume (e.g. server recovery + frontend orphan detection racing).
  // Claim the slot before the dynamic import to close the TOCTOU window.
  if (runningQueries.has(sessionId)) return
  const abortController = new AbortController()
  runningQueries.set(sessionId, abortController)

  const { query } = await import("@anthropic-ai/claude-agent-sdk")

  updateSessionStatus(sessionId, "running")

  const existingMessages = getSessionMessages(sessionId)
  let sequence = existingMessages.length

  // Save and broadcast the user's prompt as a message so it appears in the transcript
  const userMessage = {
    type: "user",
    content: prompt,
    ...(userProfile && {
      authorEmail: userProfile.email,
      authorName: userProfile.name,
    }),
  }
  appendSessionMessage(sessionId, sequence, "user", userMessage)
  broadcastToSession(sessionId, { sequence, message: userMessage })
  sequence++

  const q = query({
    prompt,
    options: {
      resume: sessionId,
      cwd: workspacePath,
      systemPrompt: { type: "preset", preset: "claude_code" },
      settingSources: ["project"],
      allowedTools: ["Read", "Grep", "Glob", "Bash", "Write", "Edit"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      abortController,
      env: buildAgentEnv(userSessionToken),
      canUseTool: makeCanUseTool(() => sessionId),
      plugins: [
        { type: "local" as const, path: workflowPluginPath },
      ],
      mcpServers: {
        render_output: buildRenderOutputMcpServer(),
      },
    },
  })

  ;(async () => {
    try {
      for await (const message of q) {
        appendSessionMessage(sessionId, sequence, (message as any).type || "unknown", message)
        broadcastToSession(sessionId, { sequence, message })
        sequence++

        if ("result" in (message as any)) {
          updateSessionStatus(sessionId, "complete")
          broadcastToSession(sessionId, {
            type: "session_complete",
            status: "complete",
          })
        }
      }

      updateSessionStatus(sessionId, "complete")
      autoNameSession(sessionId).catch(() => {})
      runningQueries.delete(sessionId)
    } catch (err: any) {
      console.error("Session resume error:", err)
      updateSessionStatus(sessionId, "errored", err.message)
      broadcastToSession(sessionId, {
        type: "session_error",
        error: err.message,
      })
      runningQueries.delete(sessionId)
    }
  })()
}

export function attachSourceToSession(
  sessionId: string,
  source: { type: string; id: string; title: string; content: string },
) {
  const messages = getSessionMessages(sessionId)
  const nextSequence = messages.length

  const contextMessage = {
    type: "system",
    subtype: "attached_context",
    sourceType: source.type,
    sourceId: source.id,
    title: source.title,
    content: source.content,
  }

  appendSessionMessage(sessionId, nextSequence, "system", contextMessage)
  broadcastToSession(sessionId, { sequence: nextSequence, message: contextMessage })

  // Update linked source columns (last attachment wins — the actual context
  // is preserved in session_messages regardless, so multiple attachments work)
  const db = getDb()
  const now = new Date().toISOString()

  // Persist title in metadata so listSessionRecords can surface it without joins
  const existing = db.prepare("SELECT metadata FROM sessions WHERE id = ?").get(sessionId) as { metadata: string | null } | undefined
  const meta = existing?.metadata ? JSON.parse(existing.metadata) : {}
  meta.linkedItemTitle = source.title
  db.prepare(
    "UPDATE sessions SET linked_source_id = ?, linked_source_type = ?, metadata = ?, updated_at = ? WHERE id = ?",
  ).run(source.id, source.type, JSON.stringify(meta), now, sessionId)

  // Also set legacy columns for backward compat
  if (source.type === "email" || source.type === "gmail") {
    db.prepare("UPDATE sessions SET linked_email_thread_id = ?, updated_at = ? WHERE id = ?")
      .run(source.id, now, sessionId)
  } else if (source.type === "task" || source.type === "notion-tasks") {
    db.prepare("UPDATE sessions SET linked_task_id = ?, updated_at = ? WHERE id = ?")
      .run(source.id, now, sessionId)
  }
}

/** Check if a session has an active agent process (in-memory query) */
export function isSessionRunning(sessionId: string): boolean {
  return runningQueries.has(sessionId)
}

export function abortRunningSession(sessionId: string): boolean {
  const controller = runningQueries.get(sessionId)
  if (controller) {
    controller.abort()
    runningQueries.delete(sessionId)
    pendingQuestions.delete(sessionId)
    updateSessionStatus(sessionId, "complete", "Aborted by user")
    return true
  }
  return false
}

/** Index all agent SDK sessions into the DB on startup.
 *  Uses INSERT OR IGNORE so existing records are not overwritten. */
export async function indexAllAgentSessions() {
  try {
    const agentSessions = await listAgentSessions()
    const db = getDb()
    const insertStmt = db.prepare(
      `INSERT OR IGNORE INTO sessions (id, status, prompt, summary, started_at, updated_at, completed_at, trigger_source)
       VALUES (?, 'complete', ?, ?, ?, ?, ?, 'manual')`
    )
    const updateStmt = db.prepare(
      `UPDATE sessions SET prompt = ?, summary = ? WHERE id = ? AND (prompt IS NULL OR prompt = '')`
    )
    let inserted = 0
    let updated = 0
    for (const s of agentSessions) {
      const ts = new Date(s.lastModified).toISOString()
      const prompt = s.firstPrompt || ""
      const summary = (s.summary || s.firstPrompt || "").slice(0, 200)
      const result = insertStmt.run(s.sessionId, prompt, summary, ts, ts, ts)
      if (result.changes > 0) {
        inserted++
      } else if (prompt) {
        const upd = updateStmt.run(prompt, summary, s.sessionId)
        if (upd.changes > 0) updated++
      }
    }
    if (inserted > 0 || updated > 0) {
      console.log(`[server] Indexed ${inserted} new, updated ${updated} existing agent sessions`)
    }
  } catch (err) {
    console.error("[server] Failed to index agent sessions:", err)
  }
}

/** Recover sessions that were running when the server last shut down.
 *  - `running` sessions updated within cutoffMinutes are auto-resumed.
 *  - `awaiting_user_input` sessions are left as-is; the SSE handler
 *    re-delivers the original question when the user reconnects.
 *  - Old stale sessions are marked as errored. */
export async function recoverStaleSessions(cutoffMinutes = 30) {
  const db = getDb()
  const cutoff = new Date(Date.now() - cutoffMinutes * 60 * 1000).toISOString()

  // Find all sessions stuck in running/awaiting_user_input
  const staleSessions = db
    .prepare(
      `SELECT id, status, updated_at FROM sessions
       WHERE status IN ('running', 'awaiting_user_input')`,
    )
    .all() as Array<{ id: string; status: string; updated_at: string }>

  if (staleSessions.length === 0) return

  const old = staleSessions.filter((s) => s.updated_at <= cutoff)
  // Only auto-resume running sessions; awaiting_user_input sessions are
  // re-delivered to the user via the SSE handler when they reconnect.
  const toResume = staleSessions.filter((s) => s.updated_at > cutoff && s.status === "running")
  const toWait = staleSessions.filter((s) => s.updated_at > cutoff && s.status === "awaiting_user_input")

  // Mark old stale sessions as errored
  for (const session of old) {
    console.log(`[server] Marking stale session ${session.id} as errored (last updated ${session.updated_at})`)
    updateSessionStatus(session.id, "errored", "Session interrupted by server restart")
  }

  // Auto-resume recent running sessions concurrently
  const results = await Promise.allSettled(
    toResume.map(async (session) => {
      console.log(`[server] Auto-resuming session ${session.id}`)
      await resumeSessionQuery(session.id, "The server was restarted. Continue where you left off.")
    }),
  )
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      const session = toResume[i]
      console.error(`[server] Failed to recover session ${session.id}:`, (results[i] as PromiseRejectedResult).reason)
      updateSessionStatus(session.id, "errored", "Server restart recovery failed")
    }
  }

  if (toWait.length > 0) {
    console.log(`[server] ${toWait.length} session(s) awaiting user input — question will re-deliver on SSE connect`)
  }
  console.log(
    `[server] Session recovery: ${toResume.length} resumed, ${old.length} marked errored`,
  )
}

export async function listAgentSessions() {
  try {
    const { listSessions } = await import("@anthropic-ai/claude-agent-sdk")
    return listSessions({ dir: workspacePath })
  } catch {
    return []
  }
}

/** Find a single agent session by ID — checks workspace dir first, then scans others */
export async function findAgentSession(sessionId: string) {
  const fs = await import("fs")
  const { join } = await import("path")
  const { homedir } = await import("os")

  const projectsDir = join(homedir(), ".claude", "projects")
  if (!fs.existsSync(projectsDir)) return null

  function tryDir(dirPath: string) {
    const filePath = join(dirPath, `${sessionId}.jsonl`)
    if (!fs.existsSync(filePath)) return null

    try {
      const stat = fs.statSync(filePath)
      const { headLines, tailLines } = readHeadTailLines(filePath, 20, 10, fs)
      const { cwd, firstPrompt, summary } = extractSessionMeta(headLines, tailLines)
      if (!cwd) return null

      return {
        sessionId,
        summary,
        lastModified: stat.mtimeMs,
        firstPrompt,
        cwd,
        project: projectLabel(cwd),
      }
    } catch {
      return null
    }
  }

  // Try the current workspace directory first (most common case)
  const primaryDir = join(projectsDir, workspacePath.replace(/\//g, "-"))
  const primary = tryDir(primaryDir)
  if (primary) return primary

  // Fall back to scanning all directories
  const dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory())

  for (const dir of dirs) {
    const dirPath = join(projectsDir, dir.name)
    if (dirPath === primaryDir) continue // already checked
    const result = tryDir(dirPath)
    if (result) return result
  }

  return null
}

/** Read the first N and last N lines of a file without loading it entirely into memory */
function readHeadTailLines(
  filePath: string,
  headCount: number,
  tailCount: number,
  fs: typeof import("fs"),
): { headLines: string[]; tailLines: string[] } {
  const CHUNK = 8192
  const fd = fs.openSync(filePath, "r")
  try {
    const stat = fs.fstatSync(fd)
    const size = stat.size
    if (size === 0) return { headLines: [], tailLines: [] }

    // Read head
    const headBuf = Buffer.alloc(Math.min(CHUNK * 4, size))
    const headBytesRead = fs.readSync(fd, headBuf, 0, headBuf.length, 0)
    const headLines = headBuf.toString("utf-8", 0, headBytesRead).split("\n").slice(0, headCount)

    // Read tail
    const tailLines: string[] = []
    if (size > headBuf.length) {
      const tailSize = Math.min(CHUNK * 4, size)
      const tailBuf = Buffer.alloc(tailSize)
      const tailBytesRead = fs.readSync(fd, tailBuf, 0, tailSize, size - tailSize)
      const allTail = tailBuf.toString("utf-8", 0, tailBytesRead).split("\n")
      tailLines.push(...allTail.slice(-tailCount))
    }

    return { headLines, tailLines }
  } finally {
    fs.closeSync(fd)
  }
}

function extractSessionMeta(headLines: string[], tailLines: string[]) {
  let cwd: string | null = null
  let firstPrompt: string | null = null
  let summary: string | null = null

  // Head lines: find cwd and firstPrompt
  for (const line of headLines) {
    if (!line.trim()) continue
    try {
      const msg = JSON.parse(line)
      if (!cwd && msg.cwd) cwd = msg.cwd
      if (!firstPrompt && (msg.type === "user" || msg.role === "user")) {
        const content = msg.message?.content ?? msg.content
        if (typeof content === "string" && !content.startsWith("<")) {
          firstPrompt = content.slice(0, 200)
        } else if (Array.isArray(content)) {
          const text = content
            .filter((b: any) => b.type === "text" && !b.text?.startsWith("<"))
            .map((b: any) => b.text)
            .join(" ")
          if (text) firstPrompt = text.slice(0, 200)
        }
      }
    } catch {
      /* skip */
    }
    if (cwd && firstPrompt) break
  }

  // Tail lines: find summary (result message is typically near the end)
  for (let i = tailLines.length - 1; i >= 0; i--) {
    const line = tailLines[i]
    if (!line.trim()) continue
    try {
      const msg = JSON.parse(line)
      if ("result" in msg && typeof msg.result === "string") {
        summary = msg.result.slice(0, 200)
        break
      }
    } catch {
      /* skip */
    }
  }

  return { cwd, firstPrompt, summary }
}

/**
 * Search agent sessions (JSONL files) for a query string in raw file content.
 * Unlike listAllAgentSessions, this searches the full raw text rather than
 * the truncated firstPrompt metadata, so terms that appear deep in a prompt
 * are still found.
 */
export async function searchAgentSessions(q: string) {
  const fs = await import("fs")
  const { join } = await import("path")
  const { homedir } = await import("os")

  const projectsDir = join(homedir(), ".claude", "projects")
  if (!fs.existsSync(projectsDir)) return []

  const qLower = q.toLowerCase()

  const results: Array<{
    sessionId: string
    summary: string | null
    lastModified: number
    firstPrompt: string | null
    cwd: string
    project: string
  }> = []

  const dirs = fs
    .readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  for (const dirName of dirs) {
    const dirPath = join(projectsDir, dirName)
    try {
      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"))
      for (const fileName of files) {
        const filePath = join(dirPath, fileName)
        try {
          const stat = fs.statSync(filePath)
          // Read more lines than the list view to capture long prompts
          const { headLines, tailLines } = readHeadTailLines(filePath, 50, 10, fs)

          // Search raw content — avoids the 200-char firstPrompt truncation limit
          const rawHead = headLines.join("\n").toLowerCase()
          const rawTail = tailLines.join("\n").toLowerCase()
          if (!rawHead.includes(qLower) && !rawTail.includes(qLower)) continue

          const { cwd, firstPrompt, summary } = extractSessionMeta(headLines, tailLines)
          if (!cwd) continue

          results.push({
            sessionId: fileName.replace(".jsonl", ""),
            summary,
            lastModified: stat.mtimeMs,
            firstPrompt,
            cwd,
            project: projectLabel(cwd),
          })
        } catch {
          /* skip unreadable files */
        }
      }
    } catch {
      /* skip unreadable dirs */
    }
  }

  // Deduplicate by sessionId, keeping most recently modified
  const byId = new Map<string, (typeof results)[0]>()
  for (const r of results) {
    const existing = byId.get(r.sessionId)
    if (!existing || r.lastModified > existing.lastModified) {
      byId.set(r.sessionId, r)
    }
  }
  return [...byId.values()]
}

export async function listAllAgentSessions() {
  const fs = await import("fs")
  const { join } = await import("path")
  const { homedir } = await import("os")

  const projectsDir = join(homedir(), ".claude", "projects")
  if (!fs.existsSync(projectsDir)) return []

  const dirs = fs
    .readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  const results: Array<{
    sessionId: string
    summary: string | null
    lastModified: number
    firstPrompt: string | null
    cwd: string
    project: string
  }> = []

  for (const dirName of dirs) {
    const dirPath = join(projectsDir, dirName)
    try {
      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"))
      for (const fileName of files) {
        const filePath = join(dirPath, fileName)
        try {
          const stat = fs.statSync(filePath)
          const { headLines, tailLines } = readHeadTailLines(filePath, 20, 10, fs)
          const { cwd, firstPrompt, summary } = extractSessionMeta(headLines, tailLines)

          if (!cwd) continue

          results.push({
            sessionId: fileName.replace(".jsonl", ""),
            summary,
            lastModified: stat.mtimeMs,
            firstPrompt,
            cwd,
            project: projectLabel(cwd),
          })
        } catch {
          /* skip unreadable files */
        }
      }
    } catch {
      /* skip unreadable dirs */
    }
  }

  // Deduplicate by sessionId, keeping the most recently modified entry
  const byId = new Map<string, (typeof results)[0]>()
  for (const r of results) {
    const existing = byId.get(r.sessionId)
    if (!existing || r.lastModified > existing.lastModified) {
      byId.set(r.sessionId, r)
    }
  }
  return [...byId.values()]
}

export function projectLabel(cwd: string): string {
  // ~/Github/hammies/hammies-agent -> hammies-agent
  return cwd.split("/").pop() || cwd
}

export async function listProjectOptions(): Promise<string[]> {
  const fs = await import("fs")
  const { join } = await import("path")
  const { homedir } = await import("os")

  const projectsDir = join(homedir(), ".claude", "projects")
  if (!fs.existsSync(projectsDir)) return []

  const dirs = fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  const projects = new Set<string>()

  for (const dirName of dirs) {
    const dirPath = join(projectsDir, dirName)
    try {
      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"))

      let found = false
      for (const f of files) {
        if (found) break
        try {
          const { headLines } = readHeadTailLines(join(dirPath, f), 10, 0, fs)
          const { cwd } = extractSessionMeta(headLines, [])
          if (cwd) { projects.add(projectLabel(cwd)); found = true }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return [...projects].sort()
}

export async function getAgentSessionTranscript(sessionId: string, cwd?: string) {
  const { readFileSync } = await import("fs")
  const { join } = await import("path")
  const { homedir } = await import("os")

  // Session JSONL files are in ~/.claude/projects/{encoded-workspace-path}/
  const encodedDir = (cwd || workspacePath).replace(/\//g, "-")
  const sessionFile = join(homedir(), ".claude", "projects", encodedDir, `${sessionId}.jsonl`)

  try {
    const content = readFileSync(sessionFile, "utf-8")
    const lines = content.trim().split("\n")
    const displayTypes = new Set(["user", "assistant", "system"])
    const messages: Array<Record<string, unknown>> = []
    let sequence = 0

    for (const line of lines) {
      const msg = JSON.parse(line)

      // Detect plan file updates (Write/Edit to ~/.claude/plans/) and inject
      // a synthetic plan message so the frontend can render the plan content.
      const toolResult = msg.toolUseResult
      if (
        toolResult &&
        typeof toolResult.filePath === "string" &&
        toolResult.filePath.includes(".claude/plans/") &&
        toolResult.content
      ) {
        messages.push({
          id: sequence,
          sessionId,
          sequence,
          type: "plan",
          message: {
            type: "plan",
            filePath: toolResult.filePath,
            content: toolResult.content,
          },
          createdAt: msg.timestamp || new Date().toISOString(),
        })
        sequence++
        continue
      }

      if (displayTypes.has(msg.type)) {
        messages.push({
          id: sequence,
          sessionId,
          sequence,
          type: msg.type,
          message: msg,
          createdAt: msg.timestamp || new Date().toISOString(),
        })
        sequence++
      }
    }

    return messages
  } catch {
    return []
  }
}

/**
 * Patch the code of a render_output artifact.
 * Handles both DB sessions (SQLite) and JSONL-only sessions.
 */
export async function patchArtifactCode(sessionId: string, sequence: number, code: string): Promise<boolean> {
  if (patchArtifactInDb(sessionId, sequence, code)) return true

  // Locate the JSONL file (may be in a different workspace directory)
  const agentSession = await findAgentSession(sessionId)
  if (agentSession) {
    return patchArtifactInJsonl(sessionId, sequence, code, agentSession.cwd)
  }

  return false
}

/** Mutate a render_output tool_use block's code in a parsed message. Returns true if modified. */
function patchRenderOutputCode(msg: any, code: string): boolean {
  const content = msg.message?.content || msg.content || []
  if (!Array.isArray(content)) return false
  for (const block of content) {
    if (block.type !== "tool_use") continue
    if (block.name !== "render_output" && block.name !== "mcp__render_output__render_output") continue
    if (typeof block.input?.data === "string") {
      block.input.data = code
    } else if (block.input?.data && typeof block.input.data === "object") {
      block.input.data.code = code
    }
    return true
  }
  return false
}

function patchArtifactInDb(sessionId: string, sequence: number, code: string): boolean {
  try {
    const db = getDb()
    const row = db
      .prepare("SELECT message FROM session_messages WHERE session_id = ? AND sequence = ?")
      .get(sessionId, sequence) as { message: string } | undefined
    if (!row) {
      console.warn(`[patchArtifactInDb] No message at sequence=${sequence} for session=${sessionId}`)
      return false
    }

    const msg = JSON.parse(row.message)
    if (!patchRenderOutputCode(msg, code)) {
      const content = msg.message?.content || msg.content || []
      const toolNames = Array.isArray(content) ? content.filter((b: any) => b.type === "tool_use").map((b: any) => b.name) : []
      console.warn(`[patchArtifactInDb] No render_output block at sequence=${sequence}. Tool names: ${JSON.stringify(toolNames)}, msg.type=${msg.type}`)
      return false
    }

    db.prepare("UPDATE session_messages SET message = ? WHERE session_id = ? AND sequence = ?")
      .run(JSON.stringify(msg), sessionId, sequence)
    return true
  } catch {
    return false
  }
}

async function patchArtifactInJsonl(sessionId: string, sequence: number, code: string, cwd?: string): Promise<boolean> {
  const { readFileSync, writeFileSync } = await import("fs")
  const { join } = await import("path")
  const { homedir } = await import("os")

  const encodedDir = (cwd || workspacePath).replace(/\//g, "-")
  const sessionFile = join(homedir(), ".claude", "projects", encodedDir, `${sessionId}.jsonl`)

  try {
    const content = readFileSync(sessionFile, "utf-8")
    const lines = content.trim().split("\n")
    const displayTypes = new Set(["user", "assistant", "system"])
    let seq = 0

    for (let i = 0; i < lines.length; i++) {
      const msg = JSON.parse(lines[i])

      const toolResult = msg.toolUseResult
      if (toolResult && typeof toolResult.filePath === "string" && toolResult.filePath.includes(".claude/plans/") && toolResult.content) {
        seq++
        continue
      }

      if (!displayTypes.has(msg.type)) continue

      if (seq === sequence && msg.type === "assistant") {
        if (patchRenderOutputCode(msg, code)) {
          lines[i] = JSON.stringify(msg)
          writeFileSync(sessionFile, lines.join("\n") + "\n")
          return true
        }
        return false
      }
      seq++
    }

    return false
  } catch {
    return false
  }
}
