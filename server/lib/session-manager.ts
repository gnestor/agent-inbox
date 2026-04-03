import { resolve, join } from "path"
import * as fs from "fs"
import { homedir } from "os"

const INITIAL_SUMMARY_LENGTH = 80
const AGENT_SDK_BETAS = ["context-1m-2025-08-07"]
import { query, queryOne, execute, withTransaction } from "../db/pool.js"
import { getAgentEnv } from "./credentials.js"
import { generateSessionTitle } from "./title-generator.js"
import type { CredentialProxy } from "./credential-proxy.js"
import { buildRenderOutputMcpServer } from "./render-output-tool.js"
import { RENDER_OUTPUT_NAMES } from "../../src/types/session-message.js"
import { SESSION_INSTRUCTIONS } from "./session-instructions.js"

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
        await updateSessionStatus(sessionId, "awaiting_user_input")
        broadcastToSession(sessionId, { type: "ask_user_question", questions: input.questions })

        const answers = await new Promise<Record<string, string>>((resolve) => {
          pendingQuestions.set(sessionId, resolve)
        })

        if (process.env.NODE_ENV !== "production") {
          console.log(`[session:${sessionId}] user_answered:`, Object.keys(answers))
        }
        await updateSessionStatus(sessionId, "running")
        return { behavior: "allow", updatedInput: { ...input, answers } }
      }
    }
    return { behavior: "allow" }
  }
}

// Build env for agent, excluding sensitive keys. When the credential proxy
// is running, route traffic through it instead of passing raw API tokens.
function buildAgentEnv(workspaceId?: string, userSessionToken?: string): Record<string, string> {
  const env: Record<string, string> = {}

  // Base env: inherit process env minus sensitive keys.
  // When the credential proxy is active it injects these into outgoing requests;
  // when it is not, the fallback getAgentEnv() re-adds them from the workspace .env.
  const excluded = new Set([
    // Server / harness secrets
    "ANTHROPIC_API_KEY", "CLAUDECODE", "CLAUDE_CODE_OAUTH_TOKEN", "VAULT_SECRET",
    // OAuth credentials
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN",
    "PINTEREST_ACCESS_TOKEN", "PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET", "PINTEREST_REFRESH_TOKEN",
    "QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QUICKBOOKS_REFRESH_TOKEN",
    // API keys / tokens for HTTP services (proxy injects these)
    "AIR_API_KEY",
    "FACEBOOK_ACCESS_TOKEN",
    "GEMINI_API_KEY",
    "GITHUB_API_TOKEN", "GITHUB_TOKEN",
    "GORGIAS_API_TOKEN",
    "INSTAGRAM_ACCESS_TOKEN",
    "KLAVIYO_PRIVATE_KEY",
    "META_ACCESS_TOKEN",
    "NOTION_API_TOKEN",
    "SHOPIFY_API_TOKEN", "SHOPIFY_ACCESS_TOKEN",
    "SLACK_BOT_TOKEN", "SLACK_API_TOKEN",
    // Unused but potentially present
    "HAPPY_RETURNS_API_KEY", "SHIPPO_API_TOKEN", "OBSERVABLE_API_TOKEN",
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
    Object.assign(env, getAgentEnv(workspaceId))
  }

  return env
}

/**
 * Discover Agent SDK plugin directories for a workspace session.
 * Returns paths to core plugin (inbox/plugins/core) and all workspace plugins.
 */
import { fileURLToPath } from "url"

// Resolve inbox package root from this file's location (server/lib/session-manager.ts → ../../)
const INBOX_PLUGINS_DIR = resolve(fileURLToPath(import.meta.url), "../../../plugins/core")

function getAgentPluginPaths(wsPath: string): { type: "local"; path: string }[] {
  const wsPluginsDir = resolve(wsPath, "plugins")

  const plugins: { type: "local"; path: string }[] = []

  if (fs.existsSync(INBOX_PLUGINS_DIR)) {
    plugins.push({ type: "local", path: INBOX_PLUGINS_DIR })
  }

  if (fs.existsSync(wsPluginsDir)) {
    for (const entry of fs.readdirSync(wsPluginsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        plugins.push({ type: "local", path: resolve(wsPluginsDir, entry.name) })
      }
    }
  }

  return plugins
}

/** Resolve a session's JSONL file path from its cwd (or default workspace). */
function sessionJsonlPath(sessionId: string, cwd?: string): string {
  const encodedDir = (cwd || defaultWorkspacePath).replace(/\//g, "-")
  return join(homedir(), ".claude", "projects", encodedDir, `${sessionId}.jsonl`)
}

/** Resolve the projects directory for a workspace path. */
function workspaceProjectsDir(cwd?: string): string {
  const encodedDir = (cwd || defaultWorkspacePath).replace(/\//g, "-")
  return join(homedir(), ".claude", "projects", encodedDir)
}

// Legacy compat — default workspace path for callers not yet migrated
let defaultWorkspacePath = ""
let defaultWorkspaceName = ""

export function setWorkspacePath(path: string) {
  defaultWorkspacePath = resolve(path)
  import("./workspace-scanner.js").then(({ deriveWorkspaceName }) => {
    defaultWorkspaceName = deriveWorkspaceName(path)
  }).catch(() => {
    defaultWorkspaceName = path.split("/").pop() || path
  })
}

export function getWorkspacePath() {
  return defaultWorkspacePath
}

/** Workspace name derived from git repo name (e.g., "hammies-agent") */
export function getWorkspaceName() {
  return defaultWorkspaceName
}

export async function createSessionRecord(
  sessionId: string,
  prompt: string,
  options?: {
    linkedSourceType?: string
    linkedSourceId?: string
    triggerSource?: string
    linkedItemTitle?: string
  },
) {
  const now = new Date().toISOString()
  const metadata = options?.linkedItemTitle
    ? JSON.stringify({ linkedItemTitle: options.linkedItemTitle })
    : null

  const summary = options?.linkedItemTitle || prompt.slice(0, INITIAL_SUMMARY_LENGTH)

  await execute(
    `INSERT INTO sessions (id, status, prompt, summary, started_at, updated_at, linked_source_type, linked_source_id, trigger_source, metadata)
     VALUES ($1, 'running', $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      sessionId,
      prompt,
      summary,
      now,
      now,
      options?.linkedSourceType || null,
      options?.linkedSourceId || null,
      options?.triggerSource || "manual",
      metadata,
    ],
  )
}

/** Extract the questions array from the last AskUserQuestion tool_use in the session transcript.
 *  Reads the JSONL file backward (last 20 lines) for efficiency. */
export async function getLastAskUserQuestions(sessionId: string): Promise<unknown[] | null> {
  try {
    const agentSession = await findAgentSession(sessionId)
    if (!agentSession) return null
    const transcript = await getAgentSessionTranscript(sessionId, agentSession.cwd)
    // Scan assistant messages from the end
    for (let i = transcript.length - 1; i >= 0; i--) {
      const msg = transcript[i]
      if (msg.type !== "assistant") continue
      const content = (msg.message as any)?.message?.content ?? (msg.message as any)?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type === "tool_use" && block.name === "AskUserQuestion" && block.input?.questions) {
          return block.input.questions
        }
      }
    }
  } catch {}
  return null
}

async function touchSession(sessionId: string) {
  const now = new Date().toISOString()
  await execute(`UPDATE sessions SET updated_at = $1 WHERE id = $2`, [now, sessionId])
}

export async function updateSessionStatus(sessionId: string, status: string, summary?: string) {
  const now = new Date().toISOString()

  if (status === "complete" || status === "errored") {
    // Don't overwrite archived status with terminal stream states (race condition guard)
    const current = await queryOne<{ status: string }>(
      "SELECT status FROM sessions WHERE id = $1",
      [sessionId],
    )
    if (current?.status === "archived") {
      if (process.env.NODE_ENV !== "production") {
        console.log(`[session:${sessionId}] status change blocked: archived → ${status}`)
      }
      return
    }
    if (process.env.NODE_ENV !== "production") {
      console.log(`[session:${sessionId}] ${current?.status ?? "unknown"} → ${status}`)
    }

    await execute(
      `UPDATE sessions SET status = $1, summary = COALESCE($2, summary), completed_at = $3, updated_at = $4 WHERE id = $5`,
      [status, summary || null, now, now, sessionId],
    )
  } else {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[session:${sessionId}] → ${status}`)
    }
    await execute(
      `UPDATE sessions SET status = $1, summary = COALESCE($2, summary), updated_at = $3 WHERE id = $4`,
      [status, summary || null, now, sessionId],
    )
  }
}

export async function archiveSession(sessionId: string): Promise<boolean> {
  const session = await getSessionRecord(sessionId)
  if (!session) return false

  // Abort if running (without calling abortRunningSession which would set status to "complete")
  const controller = runningQueries.get(sessionId)
  if (controller) {
    controller.abort()
    runningQueries.delete(sessionId)
    pendingQuestions.delete(sessionId)
  }

  await updateSessionStatus(sessionId, "archived")
  return true
}

export async function unarchiveSession(sessionId: string): Promise<boolean> {
  const now = new Date().toISOString()
  const result = await execute(
    `UPDATE sessions SET status = 'complete', updated_at = $1 WHERE id = $2 AND status = 'archived'`,
    [now, sessionId],
  )
  return result.rowCount > 0
}

/** Import an agent-only session (JSONL) into the DB as a completed record. */
export async function importAgentSession(
  sessionId: string,
  agentSession: { firstPrompt?: string | null; summary?: string | null; lastModified: number }
) {
  const ts = new Date(agentSession.lastModified).toISOString()
  await execute(
    `INSERT INTO sessions (id, status, prompt, summary, started_at, updated_at, completed_at, trigger_source)
     VALUES ($1, 'complete', $2, $3, $4, $5, $6, 'manual')
     ON CONFLICT DO NOTHING`,
    [
      sessionId,
      agentSession.firstPrompt || "",
      (agentSession.summary || agentSession.firstPrompt || "").slice(0, 200),
      ts,
      ts,
      ts,
    ],
  )
}

export async function updateSessionSummary(sessionId: string, summary: string) {
  await execute(
    "UPDATE sessions SET summary = $1, updated_at = $2 WHERE id = $3",
    [summary, new Date().toISOString(), sessionId],
  )
}

export async function getSessionRecord(sessionId: string) {
  return await queryOne<Record<string, unknown>>(
    "SELECT * FROM sessions WHERE id = $1",
    [sessionId],
  )
}

/** Count lines in a session's JSONL file. */
async function getSessionMessageCount(sessionId: string): Promise<number> {
  try {
    const agentSession = await findAgentSession(sessionId)
    if (!agentSession) return 0

    const sessionFile = sessionJsonlPath(sessionId, agentSession.cwd)
    const stat = fs.statSync(sessionFile)
    if (stat.size === 0) return 0
    // Count newlines by reading the buffer without splitting into strings
    const buf = fs.readFileSync(sessionFile)
    let count = 0
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) count++
    }
    return count
  } catch {
    return 0
  }
}

export async function getLinkedSession(
  linkedSourceType?: string,
  linkedSourceId?: string,
): Promise<Record<string, unknown> | undefined> {
  if (!linkedSourceType || !linkedSourceId) return undefined
  return await queryOne<Record<string, unknown>>(
    "SELECT * FROM sessions WHERE linked_source_type = $1 AND linked_source_id = $2 ORDER BY updated_at DESC LIMIT 1",
    [linkedSourceType, linkedSourceId],
  )
}

export async function listSessionRecords(filters?: {
  status?: string
  triggerSource?: string
  q?: string
}) {
  const conditions: string[] = []
  const params: unknown[] = []
  let paramIndex = 1

  if (filters?.status) {
    const values = filters.status.split(",")
    if (values.length === 1) {
      conditions.push(`s.status = $${paramIndex++}`)
      params.push(values[0])
    } else {
      const placeholders = values.map(() => `$${paramIndex++}`)
      conditions.push(`s.status IN (${placeholders.join(",")})`)
      params.push(...values)
    }
  }
  if (filters?.triggerSource) {
    conditions.push(`s.trigger_source = $${paramIndex++}`)
    params.push(filters.triggerSource)
  }

  let sql: string
  if (filters?.q) {
    const like = `%${filters.q}%`
    sql = "SELECT s.*, s.metadata->>'linkedItemTitle' AS linked_item_title FROM sessions s"
    conditions.push(`(s.prompt LIKE $${paramIndex++} OR s.summary LIKE $${paramIndex++})`)
    params.push(like, like)
  } else {
    sql = "SELECT s.*, s.metadata->>'linkedItemTitle' AS linked_item_title FROM sessions s"
  }

  if (conditions.length) {
    sql += " WHERE " + conditions.join(" AND ")
  }
  sql += " ORDER BY s.updated_at DESC"

  return await query<Record<string, unknown>>(sql, params)
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
export async function addSseClient(sessionId: string, send: (data: string) => void) {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set())
  }
  sseClients.get(sessionId)!.add(send)
  if (process.env.NODE_ENV !== "production") {
    console.log(`[sse:${sessionId}] client connected (${sseClients.get(sessionId)!.size} total)`)
  }

  // Send current session status on connect so the client doesn't rely on
  // stale React Query cache. Covers cases where the session completed or
  // errored before the SSE connection was established.
  const session = await getSessionRecord(sessionId)
  if (session?.status === "complete") {
    send(JSON.stringify({ type: "session_complete", status: "complete" }))
  } else if (session?.status === "errored") {
    send(JSON.stringify({ type: "session_error", status: "errored" }))
  } else if (session?.status === "awaiting_user_input") {
    // Re-deliver the last AskUserQuestion — the original broadcast may have
    // fired before any browser was connected.
    const questions = await getLastAskUserQuestions(sessionId)
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
    const session = await getSessionRecord(sessionId)
    if (!session) return

    // Skip if user has manually renamed the session
    const initialSummary = (session.prompt as string).slice(0, INITIAL_SUMMARY_LENGTH)
    if (session.summary !== initialSummary) return

    const agentSession = await findAgentSession(sessionId)
    if (!agentSession) return
    const transcript = await getAgentSessionTranscript(sessionId, agentSession.cwd)
    if (transcript.length < 2) return // Skip trivial sessions (e.g. immediate errors)

    const title = await generateSessionTitle(
      transcript.map((m) => ({ type: m.type as string, message: JSON.stringify(m.message) }))
    )
    if (title) {
      await updateSessionSummary(sessionId, title)
    }
  } catch (err) {
    console.error("Auto-naming failed for session", sessionId, err)
  }
}

function buildSourceContext(
  sourceType?: string | null,
  sourceId?: string | null,
  sourceContent?: string | null,
): string | null {
  if (sourceType && sourceId) {
    const header = `Source context: ${sourceType} item ${sourceId}`
    return sourceContent ? `${header}\n\n${sourceContent}` : header
  }
  return null
}

function buildSystemPrompt(context: string | null) {
  const append = [SESSION_INSTRUCTIONS, context].filter(Boolean).join("\n\n")
  return { type: "preset" as const, preset: "claude_code" as const, append }
}

// Session execution using Agent SDK
export async function startSession(
  prompt: string,
  options?: {
    linkedSourceType?: string
    linkedSourceId?: string
    linkedSourceContent?: string
    linkedItemTitle?: string
    triggerSource?: string
    userSessionToken?: string
    workspacePath?: string
  },
): Promise<string> {
  // Dynamic import to avoid issues at startup
  const { query: agentQuery } = await import("@anthropic-ai/claude-agent-sdk")

  const wsPath = options?.workspacePath || defaultWorkspacePath
  const abortController = new AbortController()
  let sessionId: string | null = null

  const sourceContext = buildSourceContext(
    options?.linkedSourceType, options?.linkedSourceId, options?.linkedSourceContent,
  )
  if (sourceContext) console.log(`[session] Source context: ${sourceContext.slice(0, 100)}...`)
  else console.log(`[session] No source context (type=${options?.linkedSourceType}, id=${options?.linkedSourceId})`)

  const q = agentQuery({
    prompt,
    options: {
      cwd: wsPath,
      systemPrompt: buildSystemPrompt(sourceContext),
      settingSources: ["project"],
      allowedTools: ["Read", "Grep", "Glob", "Bash", "Write", "Edit", "Skill"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      abortController,
      env: buildAgentEnv(undefined, options?.userSessionToken),
      canUseTool: makeCanUseTool(() => sessionId),
      plugins: getAgentPluginPaths(wsPath),
      mcpServers: {
        render_output: buildRenderOutputMcpServer(),
      },
      betas: AGENT_SDK_BETAS
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

          // Broadcast the user's initial prompt as a synthetic message.
          // The SDK doesn't include it in the stream — it's sent as an argument.
          broadcastToSession(sessionId!, {
            sequence: sequence++,
            message: { type: "user", role: "user", content: prompt },
          })
        }

        if (sessionId) {
          await touchSession(sessionId)
          broadcastToSession(sessionId, { sequence, message })
          sequence++
        }

        // Check for result message (session complete)
        if ("result" in (message as any)) {
          if (sessionId) {
            await updateSessionStatus(sessionId, "complete")
            broadcastToSession(sessionId, {
              type: "session_complete",
              status: "complete",
            })
          }
        }
      }

      if (sessionId) {
        await updateSessionStatus(sessionId, "complete")
        autoNameSession(sessionId).catch(() => {})
        runningQueries.delete(sessionId)
      }
    } catch (err: any) {
      console.error("Session error:", err)
      if (sessionId) {
        await updateSessionStatus(sessionId, "errored", err.message)
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

  const { query: agentQuery } = await import("@anthropic-ai/claude-agent-sdk")

  await updateSessionStatus(sessionId, "running")

  const sessionRecord = await getSessionRecord(sessionId)
  const resumeSourceContext = buildSourceContext(
    sessionRecord?.linked_source_type as string | undefined,
    sessionRecord?.linked_source_id as string | undefined,
  )

  let sequence = await getSessionMessageCount(sessionId)

  // Broadcast the user's prompt so it appears in the live transcript
  const userMessage = {
    type: "user",
    content: prompt,
    ...(userProfile && {
      authorEmail: userProfile.email,
      authorName: userProfile.name,
    }),
  }
  broadcastToSession(sessionId, { sequence, message: userMessage })
  sequence++

  const wsPath = defaultWorkspacePath

  const q = agentQuery({
    prompt,
    options: {
      resume: sessionId,
      cwd: wsPath,
      systemPrompt: buildSystemPrompt(resumeSourceContext),
      settingSources: ["project"],
      allowedTools: ["Read", "Grep", "Glob", "Bash", "Write", "Edit", "Skill"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      abortController,
      env: buildAgentEnv(undefined, userSessionToken),
      canUseTool: makeCanUseTool(() => sessionId),
      plugins: getAgentPluginPaths(wsPath),
      mcpServers: {
        render_output: buildRenderOutputMcpServer(),
      },
      betas: AGENT_SDK_BETAS
    },
  })

  ;(async () => {
    try {
      for await (const message of q) {
        await touchSession(sessionId)
        broadcastToSession(sessionId, { sequence, message })
        sequence++

        if ("result" in (message as any)) {
          await updateSessionStatus(sessionId, "complete")
          broadcastToSession(sessionId, {
            type: "session_complete",
            status: "complete",
          })
        }
      }

      await updateSessionStatus(sessionId, "complete")
      broadcastToSession(sessionId, { type: "session_complete", status: "complete" })
      autoNameSession(sessionId).catch(() => {})
      runningQueries.delete(sessionId)
    } catch (err: any) {
      console.error("Session resume error:", err)
      await updateSessionStatus(sessionId, "errored", err.message)
      broadcastToSession(sessionId, {
        type: "session_error",
        error: err.message,
      })
      runningQueries.delete(sessionId)
    }
  })()
}

export async function attachSourceToSession(
  sessionId: string,
  source: { type: string; id: string; title: string; content: string },
) {
  const nextSequence = await getSessionMessageCount(sessionId)

  const contextMessage = {
    type: "system",
    subtype: "attached_context",
    sourceType: source.type,
    sourceId: source.id,
    title: source.title,
    content: source.content,
  }

  // Append to JSONL file
  try {

    const agentSession = await findAgentSession(sessionId)
    const sessionFile = sessionJsonlPath(sessionId, agentSession?.cwd)
    await fs.promises.appendFile(sessionFile, JSON.stringify(contextMessage) + "\n")
  } catch (err) {
    console.warn(`[attachSource] Failed to append to JSONL for ${sessionId}:`, (err as Error).message)
  }

  broadcastToSession(sessionId, { sequence: nextSequence, message: contextMessage })

  // Update linked source columns
  const now = new Date().toISOString()
  await execute(`
    UPDATE sessions
    SET linked_source_id = $1,
        linked_source_type = $2,
        metadata = jsonb_set(COALESCE(metadata, '{}')::jsonb, '{linkedItemTitle}', to_jsonb($3::text)),
        updated_at = $4
    WHERE id = $5
  `, [source.id, source.type, source.title, now, sessionId])
}

/** Check if a session has an active agent process (in-memory query) */
export function isSessionRunning(sessionId: string): boolean {
  return runningQueries.has(sessionId)
}

export async function abortRunningSession(sessionId: string): Promise<boolean> {
  const controller = runningQueries.get(sessionId)
  if (controller) {
    controller.abort()
    runningQueries.delete(sessionId)
    pendingQuestions.delete(sessionId)
    await updateSessionStatus(sessionId, "complete", "Aborted by user")
    return true
  }
  return false
}

/** Index all agent SDK sessions into the DB on startup.
 *  Uses INSERT ... ON CONFLICT DO NOTHING so existing records are not overwritten. */
export async function indexAllAgentSessions() {
  try {
    const agentSessions = await listAgentSessions()
    let inserted = 0
    let updated = 0
    await withTransaction(async (client) => {
      for (const s of agentSessions) {
        const ts = new Date(s.lastModified).toISOString()
        const prompt = s.firstPrompt || ""
        const summary = (s.summary || s.firstPrompt || "").slice(0, 200)
        const insertResult = await client.query(
          `INSERT INTO sessions (id, status, prompt, summary, started_at, updated_at, completed_at, trigger_source)
           VALUES ($1, 'complete', $2, $3, $4, $5, $6, 'manual')
           ON CONFLICT DO NOTHING`,
          [s.sessionId, prompt, summary, ts, ts, ts],
        )
        if ((insertResult.rowCount ?? 0) > 0) {
          inserted++
        } else if (prompt) {
          const updResult = await client.query(
            `UPDATE sessions SET prompt = $1, summary = $2 WHERE id = $3 AND (prompt IS NULL OR prompt = '')`,
            [prompt, summary, s.sessionId],
          )
          if ((updResult.rowCount ?? 0) > 0) updated++
        }
      }
    })
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
  const cutoff = new Date(Date.now() - cutoffMinutes * 60 * 1000).toISOString()

  // Find all sessions stuck in running/awaiting_user_input
  const staleSessions = await query<{ id: string; status: string; updated_at: string }>(
    `SELECT id, status, updated_at FROM sessions
     WHERE status IN ('running', 'awaiting_user_input')`,
  )

  if (staleSessions.length === 0) return

  const old = staleSessions.filter((s) => s.updated_at <= cutoff)
  // Only auto-resume running sessions; awaiting_user_input sessions are
  // re-delivered to the user via the SSE handler when they reconnect.
  const toResume = staleSessions.filter((s) => s.updated_at > cutoff && s.status === "running")
  const toWait = staleSessions.filter((s) => s.updated_at > cutoff && s.status === "awaiting_user_input")

  // Mark old stale sessions as errored
  for (const session of old) {
    await updateSessionStatus(session.id, "errored", "Session interrupted by server restart")
  }

  // Auto-resume recent running sessions concurrently
  const results = await Promise.allSettled(
    toResume.map(async (session) => {
      await resumeSessionQuery(session.id, "The server was restarted. Continue where you left off.")
    }),
  )
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      const session = toResume[i]
      console.error(`[server] Failed to recover session ${session.id}:`, (results[i] as PromiseRejectedResult).reason)
      await updateSessionStatus(session.id, "errored", "Server restart recovery failed")
    }
  }

  if (toResume.length > 0 || old.length > 0 || toWait.length > 0) {
    const parts: string[] = []
    if (toResume.length > 0) parts.push(`${toResume.length} resumed`)
    if (old.length > 0) parts.push(`${old.length} marked errored`)
    if (toWait.length > 0) parts.push(`${toWait.length} awaiting input`)
    console.log(`[server] Session recovery: ${parts.join(", ")}`)
  }
}

/**
 * Poll the ~/.claude/projects/{workspace} directory for new/changed JSONL session files.
 * Only checks the project directory for the active workspace, not all projects.
 * Uses polling instead of fs.watch to avoid EMFILE errors when many watchers are active.
 */
export async function watchProjectsDir(): Promise<void> {


  const watchDir = workspaceProjectsDir()
  if (!fs.existsSync(watchDir)) return

  // Track last-seen mtime for each file to detect changes
  const knownMtimes = new Map<string, number>()

  async function poll() {
    try {
      const files = fs.readdirSync(watchDir).filter((f: string) => f.endsWith(".jsonl"))
      const changed: string[] = []

      for (const file of files) {
        const fullPath = join(watchDir, file)
        try {
          const stat = fs.statSync(fullPath)
          const prev = knownMtimes.get(fullPath)
          if (prev === undefined || stat.mtimeMs > prev) {
            knownMtimes.set(fullPath, stat.mtimeMs)
            if (prev !== undefined) changed.push(fullPath) // skip first scan
          }
        } catch { /* skip unreadable */ }
      }

      if (changed.length > 0) {
        await indexNewSessions(changed, fs)
      }
    } catch (err) {
      console.warn("[watcher] Poll error:", err)
    }
  }

  async function indexNewSessions(filePaths: string[], fs: typeof import("fs")) {
    for (const filePath of filePaths) {
      try {
        const stat = fs.statSync(filePath)
        const { headLines, tailLines } = readHeadTailLines(filePath, 20, 10, fs)
        const { cwd, firstPrompt, summary } = extractSessionMeta(headLines, tailLines)
        if (!cwd) continue

        const sessionId = filePath.split("/").pop()!.replace(".jsonl", "")
        await importAgentSession(sessionId, {
          firstPrompt,
          summary,
          lastModified: stat.mtimeMs,
        })
      } catch { /* skip unreadable files */ }
    }
  }

  // Initial scan to populate known mtimes
  await poll()

  // Poll every 5 seconds
  setInterval(poll, 5000)

}

export async function listAgentSessions() {
  try {
    const { listSessions } = await import("@anthropic-ai/claude-agent-sdk")
    return listSessions({ dir: defaultWorkspacePath })
  } catch {
    return []
  }
}

/** Find a single agent session by ID — checks workspace dir first, then scans others */
export async function findAgentSession(sessionId: string) {


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
  const primaryDir = join(projectsDir, defaultWorkspacePath.replace(/\//g, "-"))
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
export async function searchAgentSessions(q: string, wsPath?: string) {


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

  // If workspace path provided, only scan its specific directory
  const dirs = wsPath
    ? [wsPath.replace(/\//g, "-")]
    : fs.readdirSync(projectsDir, { withFileTypes: true })
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

/**
 * List agent SDK sessions for a specific workspace path.
 * Sessions are stored in ~/.claude/projects/{encoded-path}/ where
 * the encoded path is the workspace path with / replaced by -.
 * If no workspace path is given, falls back to scanning all directories.
 */
export async function listAllAgentSessions(wsPath?: string) {


  const projectsDir = join(homedir(), ".claude", "projects")
  if (!fs.existsSync(projectsDir)) return []

  // If workspace path provided, only scan its specific directory
  const dirs = wsPath
    ? [wsPath.replace(/\//g, "-")]
    : fs.readdirSync(projectsDir, { withFileTypes: true })
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
    if (!fs.existsSync(dirPath)) continue
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
  const sessionFile = sessionJsonlPath(sessionId, cwd)

  try {
    const content = fs.readFileSync(sessionFile, "utf-8")
    const lines = content.trim().split("\n")
    const displayTypes = new Set(["user", "assistant", "system"])
    const messages: Array<Record<string, unknown>> = []
    // Collect thinking blocks from partial assistant messages so they can be
    // merged into the next complete assistant message.
    let pendingThinking: Array<Record<string, unknown>> = []

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const msg = JSON.parse(lines[lineIdx])

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
          id: lineIdx,
          sessionId,
          sequence: lineIdx,
          type: "plan",
          message: {
            type: "plan",
            filePath: toolResult.filePath,
            content: toolResult.content,
          },
          createdAt: msg.timestamp || new Date().toISOString(),
        })
        continue
      }

      if (displayTypes.has(msg.type)) {
        if (msg.type === "assistant") {
          const stop = msg.message?.stop_reason ?? msg.message?.stopReason ?? msg.stop_reason ?? msg.stopReason
          if (!stop) {
            // Partial message — collect thinking blocks for the next complete message
            const content = msg.message?.content
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block?.type === "thinking" && block.thinking) {
                  pendingThinking.push(block)
                }
              }
            }
            continue
          }

          // Complete message — prepend any collected thinking blocks
          if (pendingThinking.length > 0 && Array.isArray(msg.message?.content)) {
            msg.message.content = [...pendingThinking, ...msg.message.content]
            pendingThinking = []
          }
        }

        messages.push({
          id: lineIdx,
          sessionId,
          sequence: lineIdx,
          type: msg.type,
          message: msg,
          createdAt: msg.timestamp || new Date().toISOString(),
        })
      }
    }

    // Deduplicate render_output blocks: when the agent retries with the same
    // title, keep only the last attempt. Walk backwards to find which titles
    // have already been seen, then strip earlier duplicates.
    const seenOutputTitles = new Set<string>()
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as any
      const content: any[] | undefined =
        msg.message?.message?.content ?? msg.message?.content
      if (!Array.isArray(content)) continue
      const blockIdx = content.findIndex((b: any) =>
        b?.type === "tool_use" && RENDER_OUTPUT_NAMES.has(b.name),
      )
      if (blockIdx === -1) continue
      const title = content[blockIdx].input?.title ?? ""
      if (seenOutputTitles.has(title)) {
        content.splice(blockIdx, 1)
        if (content.length === 0) messages.splice(i, 1)
      } else {
        seenOutputTitles.add(title)
      }
    }

    return messages
  } catch {
    return []
  }
}

/**
 * Patch the code of a render_output artifact.
 * Handles both DB sessions and JSONL-only sessions.
 */
export async function patchArtifactCode(sessionId: string, sequence: number, code: string): Promise<boolean> {
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
    if (!RENDER_OUTPUT_NAMES.has(block.name)) continue
    if (typeof block.input?.data === "string") {
      block.input.data = code
    } else if (block.input?.data && typeof block.input.data === "object") {
      block.input.data.code = code
    }
    return true
  }
  return false
}

async function patchArtifactInJsonl(sessionId: string, sequence: number, code: string, cwd?: string): Promise<boolean> {
  const sessionFile = sessionJsonlPath(sessionId, cwd)

  try {
    const content = fs.readFileSync(sessionFile, "utf-8")
    const lines = content.trim().split("\n")

    // Try by line index first (matches getAgentSessionTranscript)
    if (sequence >= 0 && sequence < lines.length) {
      const msg = JSON.parse(lines[sequence])
      if (msg.type === "assistant" && patchRenderOutputCode(msg, code)) {
        lines[sequence] = JSON.stringify(msg)
        fs.writeFileSync(sessionFile, lines.join("\n") + "\n")
        return true
      }
    }

    // Fallback: scan all assistant messages for a render_output to patch.
    // Handles SSE-cached sessions where sequence doesn't match line index.
    for (let i = lines.length - 1; i >= 0; i--) {
      const msg = JSON.parse(lines[i])
      if (msg.type !== "assistant") continue
      const stop = msg.message?.stop_reason ?? msg.message?.stopReason ?? msg.stop_reason ?? msg.stopReason
      if (!stop) continue
      if (patchRenderOutputCode(msg, code)) {
        lines[i] = JSON.stringify(msg)
        fs.writeFileSync(sessionFile, lines.join("\n") + "\n")
        return true
      }
    }

    return false
  } catch {
    return false
  }
}
