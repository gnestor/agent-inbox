import { getDb } from "../db/schema.js"
import { getAgentEnv } from "./credentials.js"

// Store active SSE clients per session
const sseClients = new Map<string, Set<(data: string) => void>>()

// Store abort controllers for running sessions
const runningQueries = new Map<string, AbortController>()

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
  },
) {
  const db = getDb()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO sessions (id, status, prompt, started_at, updated_at, linked_email_id, linked_email_thread_id, linked_task_id, trigger_source)
     VALUES (?, 'running', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    prompt,
    now,
    now,
    options?.linkedEmailId || null,
    options?.linkedEmailThreadId || null,
    options?.linkedTaskId || null,
    options?.triggerSource || "manual",
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

  db.prepare(
    `UPDATE sessions SET message_count = ?, updated_at = ? WHERE id = ?`,
  ).run(sequence + 1, now, sessionId)
}

export function updateSessionStatus(
  sessionId: string,
  status: string,
  summary?: string,
) {
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
    .prepare(
      "SELECT * FROM session_messages WHERE session_id = ? ORDER BY sequence",
    )
    .all(sessionId) as Array<Record<string, unknown>>
}

export function listSessionRecords(filters?: {
  status?: string
  triggerSource?: string
}) {
  const db = getDb()
  let sql = "SELECT * FROM sessions"
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters?.status) {
    const values = filters.status.split(",")
    if (values.length === 1) {
      conditions.push("status = ?")
      params.push(values[0])
    } else {
      conditions.push(`status IN (${values.map(() => "?").join(",")})`)
      params.push(...values)
    }
  }
  if (filters?.triggerSource) {
    conditions.push("trigger_source = ?")
    params.push(filters.triggerSource)
  }

  if (conditions.length) {
    sql += " WHERE " + conditions.join(" AND ")
  }
  sql += " ORDER BY updated_at DESC"

  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>
}

// SSE client management
export function addSseClient(
  sessionId: string,
  send: (data: string) => void,
) {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set())
  }
  sseClients.get(sessionId)!.add(send)
}

export function removeSseClient(
  sessionId: string,
  send: (data: string) => void,
) {
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
    },
  })

  let sessionId: string | null = null
  let sequence = 0

  // Process messages in background
  ;(async () => {
    try {
      for await (const message of q) {
        // Capture session ID from init message
        if (
          (message as any).type === "system" &&
          (message as any).subtype === "init"
        ) {
          sessionId = (message as any).session_id

          await createSessionRecord(sessionId!, prompt, options)
          runningQueries.set(sessionId!, abortController)
        }

        if (sessionId) {
          appendSessionMessage(
            sessionId,
            sequence,
            (message as any).type || "unknown",
            message,
          )
          broadcastToSession(sessionId, { sequence, message })
          sequence++
        }

        // Check for result message (session complete)
        if ("result" in (message as any)) {
          if (sessionId) {
            updateSessionStatus(
              sessionId,
              "complete",
              (message as any).result?.slice(0, 200),
            )
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

  // Wait for session ID to be captured
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
): Promise<void> {
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
    },
  })

  ;(async () => {
    try {
      for await (const message of q) {
        appendSessionMessage(
          sessionId,
          sequence,
          (message as any).type || "unknown",
          message,
        )
        broadcastToSession(sessionId, { sequence, message })
        sequence++

        if ("result" in (message as any)) {
          updateSessionStatus(
            sessionId,
            "complete",
            (message as any).result?.slice(0, 200),
          )
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

export async function listAllAgentSessions() {
  const { readdirSync, existsSync } = await import("fs")
  const { join } = await import("path")
  const { homedir } = await import("os")
  const { listSessions } = await import("@anthropic-ai/claude-agent-sdk")

  const projectsDir = join(homedir(), ".claude", "projects")
  if (!existsSync(projectsDir)) return []

  const dirs = readdirSync(projectsDir, { withFileTypes: true })
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

  await Promise.all(
    dirs.map(async (dirName) => {
      try {
        // listSessions needs the actual cwd, but we can pass any dir and it
        // resolves to the matching ~/.claude/projects/ folder. We need to
        // reconstruct a path that maps to this dirName. Since dirName IS the
        // encoded path, we can scan .jsonl files directly if listSessions
        // doesn't support it. But first, let's check if the sessions have cwd.
        // We read the first line of a .jsonl to get the cwd, then use that.
        const { readFileSync } = await import("fs")
        const dirPath = join(projectsDir, dirName)
        const files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"))
        if (files.length === 0) return

        // Read first jsonl to get the cwd
        let cwd: string | null = null
        for (const f of files) {
          try {
            const firstLine = readFileSync(join(dirPath, f), "utf-8").split("\n")[0]
            const parsed = JSON.parse(firstLine)
            if (parsed.cwd) {
              cwd = parsed.cwd
              break
            }
          } catch { /* skip */ }
        }

        if (!cwd) return

        const sessions = await listSessions({ dir: cwd })
        const project = projectLabel(cwd)
        for (const s of sessions) {
          results.push({
            sessionId: s.sessionId,
            summary: s.summary || null,
            lastModified: s.lastModified,
            firstPrompt: s.firstPrompt || null,
            cwd: s.cwd || cwd,
            project,
          })
        }
      } catch { /* skip dirs that fail */ }
    }),
  )

  return results
}

export function projectLabel(cwd: string): string {
  // ~/Github/hammies/hammies-agent -> hammies-agent
  return cwd.split("/").pop() || cwd
}

export async function listProjectOptions(): Promise<string[]> {
  const { readdirSync, existsSync, readFileSync } = await import("fs")
  const { join } = await import("path")
  const { homedir } = await import("os")

  const projectsDir = join(homedir(), ".claude", "projects")
  if (!existsSync(projectsDir)) return []

  const dirs = readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  const projects = new Set<string>()

  for (const dirName of dirs) {
    const dirPath = join(projectsDir, dirName)
    try {
      const files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"))
      if (files.length === 0) continue

      for (const f of files) {
        try {
          const firstLine = readFileSync(join(dirPath, f), "utf-8").split("\n")[0]
          const parsed = JSON.parse(firstLine)
          if (parsed.cwd) {
            projects.add(projectLabel(parsed.cwd))
            break
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  return [...projects].sort()
}

export async function getAgentSessionTranscript(sessionId: string) {
  const { readFileSync } = await import("fs")
  const { join } = await import("path")
  const { homedir } = await import("os")

  // Session JSONL files are in ~/.claude/projects/{encoded-workspace-path}/
  const encodedDir = workspacePath.replace(/\//g, "-")
  const sessionFile = join(
    homedir(),
    ".claude",
    "projects",
    encodedDir,
    `${sessionId}.jsonl`,
  )

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
