import { getDb } from "../db/schema.js"
import { getAgentEnv } from "./credentials.js"

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
        updateSessionStatus(sessionId, "awaiting_user_input")
        broadcastToSession(sessionId, { type: "ask_user_question", questions: input.questions })

        const answers = await new Promise<Record<string, string>>((resolve) => {
          pendingQuestions.set(sessionId, resolve)
        })

        updateSessionStatus(sessionId, "running")
        return { behavior: "allow", updatedInput: { ...input, answers } }
      }
    }
    return { behavior: "allow" }
  }
}

// Build env for agent, excluding ANTHROPIC_API_KEY to use Claude subscription
function buildAgentEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  const excluded = new Set(["ANTHROPIC_API_KEY", "CLAUDECODE"])
  for (const [k, v] of Object.entries(process.env)) {
    if (!excluded.has(k) && v !== undefined) {
      env[k] = v
    }
  }
  Object.assign(env, getAgentEnv())
  return env
}

let workspacePath = ""

export function setWorkspacePath(path: string) {
  workspacePath = path
}

export function getWorkspacePath() {
  return workspacePath
}

export async function createSessionRecord(
  sessionId: string,
  prompt: string,
  options?: {
    linkedEmailId?: string
    linkedEmailThreadId?: string
    linkedTaskId?: string
    triggerSource?: string
    linkedItemTitle?: string
  },
) {
  const db = getDb()
  const now = new Date().toISOString()
  const metadata = options?.linkedItemTitle
    ? JSON.stringify({ linkedItemTitle: options.linkedItemTitle })
    : null

  db.prepare(
    `INSERT INTO sessions (id, status, prompt, started_at, updated_at, linked_email_id, linked_email_thread_id, linked_task_id, trigger_source, metadata)
     VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    prompt,
    now,
    now,
    options?.linkedEmailId || null,
    options?.linkedEmailThreadId || null,
    options?.linkedTaskId || null,
    options?.triggerSource || "manual",
    metadata,
  )
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

  db.prepare(`UPDATE sessions SET message_count = ?, updated_at = ? WHERE id = ?`).run(
    sequence + 1,
    now,
    sessionId,
  )
}

export function updateSessionStatus(sessionId: string, status: string, summary?: string) {
  const db = getDb()
  const now = new Date().toISOString()

  if (status === "complete" || status === "errored") {
    db.prepare(
      `UPDATE sessions SET status = ?, summary = COALESCE(?, summary), completed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(status, summary || null, now, now, sessionId)
  } else {
    db.prepare(
      `UPDATE sessions SET status = ?, summary = COALESCE(?, summary), updated_at = ? WHERE id = ?`,
    ).run(status, summary || null, now, sessionId)
  }
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
): Record<string, unknown> | undefined {
  const db = getDb()
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
    sql = `SELECT DISTINCT s.*, pe.subject AS linked_email_subject, json_extract(s.metadata, '$.linkedItemTitle') AS linked_task_title FROM sessions s LEFT JOIN session_messages sm ON sm.session_id = s.id LEFT JOIN processed_emails pe ON pe.thread_id = s.linked_email_thread_id`
    conditions.push("(s.prompt LIKE ? OR s.summary LIKE ? OR sm.message LIKE ?)")
    params.push(like, like, like)
  } else {
    sql = "SELECT s.*, pe.subject AS linked_email_subject, json_extract(s.metadata, '$.linkedItemTitle') AS linked_task_title FROM sessions s LEFT JOIN processed_emails pe ON pe.thread_id = s.linked_email_thread_id"
  }

  if (conditions.length) {
    sql += " WHERE " + conditions.join(" AND ")
  }
  sql += " ORDER BY s.updated_at DESC"

  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>
}

// SSE client management
export function addSseClient(sessionId: string, send: (data: string) => void) {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set())
  }
  sseClients.get(sessionId)!.add(send)
}

export function removeSseClient(sessionId: string, send: (data: string) => void) {
  sseClients.get(sessionId)?.delete(send)
  if (sseClients.get(sessionId)?.size === 0) {
    sseClients.delete(sessionId)
  }
}

export function broadcastToSession(sessionId: string, data: unknown) {
  const clients = sseClients.get(sessionId)
  if (!clients) return
  const json = JSON.stringify(data)
  for (const send of clients) {
    send(json)
  }
}

// Session execution using Agent SDK
export async function startSession(
  prompt: string,
  options?: {
    linkedEmailId?: string
    linkedEmailThreadId?: string
    linkedTaskId?: string
    triggerSource?: string
  },
): Promise<string> {
  // Dynamic import to avoid issues at startup
  const { query } = await import("@anthropic-ai/claude-agent-sdk")

  const abortController = new AbortController()
  let sessionId: string | null = null

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
      env: buildAgentEnv(),
      canUseTool: makeCanUseTool(() => sessionId),
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
            updateSessionStatus(sessionId, "complete", (message as any).result?.slice(0, 200))
            broadcastToSession(sessionId, {
              type: "session_complete",
              status: "complete",
            })
          }
        }
      }

      if (sessionId) {
        updateSessionStatus(sessionId, "complete")
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

export async function resumeSessionQuery(sessionId: string, prompt: string): Promise<void> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk")

  const abortController = new AbortController()
  runningQueries.set(sessionId, abortController)

  updateSessionStatus(sessionId, "running")

  const existingMessages = getSessionMessages(sessionId)
  let sequence = existingMessages.length

  // Save and broadcast the user's prompt as a message so it appears in the transcript
  const userMessage = { type: "user", content: prompt }
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
      env: buildAgentEnv(),
      canUseTool: makeCanUseTool(() => sessionId),
    },
  })

  ;(async () => {
    try {
      for await (const message of q) {
        appendSessionMessage(sessionId, sequence, (message as any).type || "unknown", message)
        broadcastToSession(sessionId, { sequence, message })
        sequence++

        if ("result" in (message as any)) {
          updateSessionStatus(sessionId, "complete", (message as any).result?.slice(0, 200))
          broadcastToSession(sessionId, {
            type: "session_complete",
            status: "complete",
          })
        }
      }

      updateSessionStatus(sessionId, "complete")
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
