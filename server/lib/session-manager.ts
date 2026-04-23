import { resolve, join, dirname } from "path"
import * as fs from "fs"
import { homedir } from "os"
import { createLogger } from "./logger.js"

const log = createLogger("session")

const INITIAL_SUMMARY_LENGTH = 80
const AGENT_SDK_BETAS: ["context-1m-2025-08-07"] = ["context-1m-2025-08-07"]
import { query, queryOne, execute, withTransaction } from "../db/pool.js"

/** Shape of a row in the `sessions` table. */
export interface SessionDbRow {
  id: string
  status: string
  prompt: string
  summary: string | null
  started_at: string
  updated_at: string
  completed_at: string | null
  linked_source_type: string | null
  linked_source_id: string | null
  trigger_source: string
  linked_item_title: string | null
}
import { getAgentEnv } from "./credentials.js"
import { generateSessionTitle } from "./title-generator.js"
import type { CredentialProxy } from "./credential-proxy.js"
import { buildRenderOutputMcpServer } from "./render-output-tool.js"
import { buildArtifactMcpServer } from "./artifact-tools.js"
import { RENDER_OUTPUT_NAMES, CREATE_FILE_NAMES } from "../../src/types/session-message.js"
import { SESSION_INSTRUCTIONS } from "./session-instructions.js"

let credentialProxy: CredentialProxy | null = null

export function setCredentialProxy(proxy: CredentialProxy) {
  credentialProxy = proxy
}

// Store multiplexed WebSocket clients (one WS per browser tab, watches many sessions)
interface WsClient {
  id: string
  send: (data: unknown) => void
  sessions: Set<string>
  user?: { email: string; name: string; picture?: string }
}
const wsClients = new Map<string, WsClient>()

// Store abort controllers for running sessions
const runningQueries = new Map<string, AbortController>()

// Pending AskUserQuestion answers: sessionId → resolver function
const pendingQuestions = new Map<string, (answers: Record<string, string>) => void>()

// Session statuses where the agent is actively working — either iterating
// (`running`) or paused waiting for user input (`awaiting_user_input`).
const SESSION_ACTIVE_STATUSES = ["running", "awaiting_user_input"] as const
type SessionActiveStatus = typeof SESSION_ACTIVE_STATUSES[number]
function isActiveStatus(status: string | undefined): status is SessionActiveStatus {
  return status === "running" || status === "awaiting_user_input"
}

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
          log.debug("ask_user", { sessionId, questions: input.questions })
        }
        await updateSessionStatus(sessionId, "awaiting_user_input")
        broadcastToSession(sessionId, { type: "ask_user_question", questions: input.questions })

        const answers = await new Promise<Record<string, string>>((resolve) => {
          pendingQuestions.set(sessionId, resolve)
        })

        if (process.env.NODE_ENV !== "production") {
          log.debug("user_answered", { sessionId, keys: Object.keys(answers) })
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

/** Encode a workspace path to its Claude projects directory name. */
export function encodeWorkspacePath(path: string): string {
  return path.replace(/\//g, "-")
}

/** Resolve a session's JSONL file path from its cwd (or default workspace). */
function sessionJsonlPath(sessionId: string, cwd?: string): string {
  const encodedDir = encodeWorkspacePath(cwd || defaultWorkspacePath)
  return join(homedir(), ".claude", "projects", encodedDir, `${sessionId}.jsonl`)
}

/** Resolve the projects directory for a workspace path. */
export function workspaceProjectsDir(cwd?: string): string {
  const encodedDir = encodeWorkspacePath(cwd || defaultWorkspacePath)
  return join(homedir(), ".claude", "projects", encodedDir)
}

// Legacy compat — default workspace path for callers not yet migrated
let defaultWorkspacePath = ""
let defaultWorkspaceName = ""

export function setWorkspacePath(path: string) {
  defaultWorkspacePath = resolve(path)
  import("./workspace-scanner.js").then(({ deriveWorkspaceName }) => {
    defaultWorkspaceName = deriveWorkspaceName(path)
  }).catch((err) => {
    console.debug("[session] Failed to derive workspace name, using fallback:", err)
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

/** Extract content array from a nested or flat message shape. */
function extractMessageContent(msg: Record<string, unknown>): unknown[] | null {
  const m = msg.message as Record<string, unknown> | undefined
  const nested = m?.message as Record<string, unknown> | undefined
  const content = nested?.content ?? m?.content ?? msg.content
  return Array.isArray(content) ? content : null
}

/** Type guard for SDK init messages. */
function isInitMessage(msg: unknown): msg is { type: "system"; subtype: "init"; session_id: string } {
  return typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).type === "system" && (msg as Record<string, unknown>).subtype === "init"
}

/** Type guard for SDK result messages. */
function isResultMessage(msg: unknown): msg is Record<string, unknown> & { result: string } {
  return typeof msg === "object" && msg !== null && "result" in msg
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
      const msg = transcript[i]!
      if (msg.type !== "assistant") continue
      const content = extractMessageContent(msg as Record<string, unknown>)
      if (!Array.isArray(content)) continue
      for (const rawBlock of content) {
        const block = rawBlock as Record<string, unknown>
        const input = block.input as Record<string, unknown> | undefined
        if (block.type === "tool_use" && block.name === "AskUserQuestion" && input?.questions) {
          return input.questions as unknown[]
        }
      }
    }
  } catch {}
  return null
}

// Debounce touchSession: at most one DB write per 5 seconds per session
const lastTouchTime = new Map<string, number>()
const TOUCH_DEBOUNCE_MS = 5_000

async function touchSession(sessionId: string) {
  const now = Date.now()
  const last = lastTouchTime.get(sessionId) ?? 0
  if (now - last < TOUCH_DEBOUNCE_MS) return
  lastTouchTime.set(sessionId, now)
  await execute(`UPDATE sessions SET updated_at = $1 WHERE id = $2`, [new Date(now).toISOString(), sessionId])
}

export async function updateSessionStatus(sessionId: string, status: string, summary?: string) {
  // Valid status transitions: only update if current status allows this transition
  const VALID_FROM: Record<string, string[]> = {
    running: ["complete", "errored", "awaiting_user_input", "archived"],
    awaiting_user_input: ["running", "complete", "errored"],
    complete: ["running", "archived"],
    errored: ["running", "archived"],
    archived: [],
  }

  const now = new Date().toISOString()
  const validSources = Object.entries(VALID_FROM)
    .filter(([, targets]) => targets.includes(status))
    .map(([from]) => from)

  if (validSources.length === 0) {
    log.warn("No valid source states for target status", { sessionId, status })
    return
  }

  // Don't overwrite user-facing summary with error messages — error details are
  // broadcast via the session_error WS event and shown in the UI error banner.
  const summaryToStore = status === "errored" ? null : summary

  // Atomic CAS: only update if current status is a valid source for this transition
  const { rowCount } = await execute(
    `UPDATE sessions SET status = $1, summary = COALESCE($2, summary),
     completed_at = CASE WHEN $1 IN ('complete','errored') THEN $3 ELSE completed_at END,
     updated_at = $3
     WHERE id = $4 AND status = ANY($5::text[])`,
    [status, summaryToStore, now, sessionId, validSources],
  )

  if (rowCount === 0 && process.env.NODE_ENV !== "production") {
    const current = await queryOne<{ status: string }>("SELECT status FROM sessions WHERE id = $1", [sessionId])
    log.warn("Status transition blocked", { sessionId, from: current?.status ?? "missing", to: status })
  }

  // Drop the broadcast buffer for sessions that have left the running state —
  // no further sequenced events will land, and we don't want to leak memory
  // across long-lived server processes.
  if (rowCount > 0 && (status === "complete" || status === "errored" || status === "archived")) {
    clearBroadcastBuffer(sessionId)
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
  return await queryOne<SessionDbRow>(
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
): Promise<SessionDbRow | undefined> {
  if (!linkedSourceType || !linkedSourceId) return undefined
  return await queryOne<SessionDbRow>(
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

  return await query<SessionDbRow>(sql, params)
}

// In-memory presence map: sessionId → Map<email, { user, lastSeen }>
// lastSeen is used as a heartbeat so we can reap zombie entries from WS clients
// that disconnected without running their cleanup (tab closed, network drop, etc.)
type PresenceUser = { name: string; email: string; picture?: string }
type PresenceEntry = { user: PresenceUser; lastSeen: number }
const sessionPresence = new Map<string, Map<string, PresenceEntry>>()

// Per-session debounce timers for presence broadcasts.
// Rapid add/remove cycles from the same client (e.g. reconnect flaps) would otherwise
// produce a broadcast storm; we coalesce into a single broadcast per session.
const presenceBroadcastTimers = new Map<string, NodeJS.Timeout>()
const PRESENCE_BROADCAST_DEBOUNCE_MS = 200

// A presence entry is considered stale if we haven't heard from it in PRESENCE_STALE_MS.
// The reaper runs every PRESENCE_REAP_INTERVAL_MS and also on every read.
const PRESENCE_STALE_MS = 60_000
const PRESENCE_REAP_INTERVAL_MS = 30_000

function schedulePresenceBroadcast(sessionId: string) {
  const existing = presenceBroadcastTimers.get(sessionId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    presenceBroadcastTimers.delete(sessionId)
    broadcastToSession(sessionId, { type: "presence", users: getPresenceUsers(sessionId) })
  }, PRESENCE_BROADCAST_DEBOUNCE_MS)
  // Don't let this timer keep the process alive.
  if (typeof timer.unref === "function") timer.unref()
  presenceBroadcastTimers.set(sessionId, timer)
}

export function addPresenceUser(sessionId: string, user: PresenceUser) {
  let users = sessionPresence.get(sessionId)
  if (!users) { users = new Map(); sessionPresence.set(sessionId, users) }
  // Heartbeat: re-adding an existing user just bumps lastSeen.
  users.set(user.email, { user, lastSeen: Date.now() })
  schedulePresenceBroadcast(sessionId)
}

export function removePresenceUser(sessionId: string, email: string) {
  const users = sessionPresence.get(sessionId)
  if (!users) return
  if (!users.delete(email)) return
  if (users.size === 0) sessionPresence.delete(sessionId)
  schedulePresenceBroadcast(sessionId)
}

export function getPresenceUsers(sessionId: string): PresenceUser[] {
  // Opportunistically reap stale entries for this session on read, so callers
  // never observe zombies even if the interval reaper hasn't fired yet.
  reapStalePresence(sessionId)
  return Array.from(sessionPresence.get(sessionId)?.values() ?? []).map((e) => e.user)
}

/**
 * Remove presence entries whose lastSeen is older than PRESENCE_STALE_MS.
 * Pass a sessionId to reap a single session; omit to reap all sessions.
 * Exported for testing and for the periodic reaper.
 */
export function reapStalePresence(sessionId?: string, now: number = Date.now()): number {
  let reaped = 0
  const visit = (sid: string, users: Map<string, PresenceEntry>) => {
    let changed = false
    for (const [email, entry] of users) {
      if (now - entry.lastSeen > PRESENCE_STALE_MS) {
        users.delete(email)
        changed = true
        reaped++
      }
    }
    if (users.size === 0) sessionPresence.delete(sid)
    if (changed) schedulePresenceBroadcast(sid)
  }
  if (sessionId !== undefined) {
    const users = sessionPresence.get(sessionId)
    if (users) visit(sessionId, users)
  } else {
    for (const [sid, users] of sessionPresence) visit(sid, users)
  }
  return reaped
}

// Periodic background reaper for zombie entries across all sessions.
// Guarded so tests (which import the module repeatedly) don't stack timers.
let presenceReaperInterval: NodeJS.Timeout | null = null
function startPresenceReaper() {
  if (presenceReaperInterval) return
  presenceReaperInterval = setInterval(() => {
    try { reapStalePresence() } catch { /* ignore */ }
  }, PRESENCE_REAP_INTERVAL_MS)
  if (typeof presenceReaperInterval.unref === "function") presenceReaperInterval.unref()
}
startPresenceReaper()

// Per-session ring buffer of recent sequenced broadcasts. A client that
// reconnects with a `fromSequence` cursor can ask the server to replay the
// events it missed without triggering a full REST snapshot. Lifecycle events
// (session_complete, session_error, ask_user_question, presence) are NOT
// buffered — they are re-derived on subscribe from DB/presence state.
export const BROADCAST_BUFFER_CAPACITY = 500

interface BufferedBroadcast { sequence: number; data: unknown }

const broadcastBuffers = new Map<string, BufferedBroadcast[]>()

function isSequencedBroadcast(data: unknown): data is { sequence: number; message: unknown } {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as { sequence?: unknown }).sequence === "number" &&
    "message" in data
  )
}

function pushBroadcastBuffer(sessionId: string, data: { sequence: number; message: unknown }) {
  let buf = broadcastBuffers.get(sessionId)
  if (!buf) {
    buf = []
    broadcastBuffers.set(sessionId, buf)
  }
  buf.push({ sequence: data.sequence, data })
  if (buf.length > BROADCAST_BUFFER_CAPACITY) buf.shift()
}

/** Returns buffered events with sequence > fromSequence, or null if the
 *  caller's cursor is older than the buffer's oldest entry (i.e. fell out
 *  of the window — caller must fall back to a full snapshot). */
export function readBroadcastBufferSince(
  sessionId: string,
  fromSequence: number,
): BufferedBroadcast[] | null {
  const buf = broadcastBuffers.get(sessionId)
  if (!buf || buf.length === 0) {
    // No buffer for this session yet. If the client says "I have no prior
    // state" (fromSequence <= 0) we can return empty; anything higher is a
    // miss and must fall back to snapshot.
    return fromSequence <= 0 ? [] : null
  }
  const oldest = buf[0]!.sequence
  // Buffer covers [oldest..], caller wants (fromSequence..]. Covered iff
  // the first event we would need to replay (fromSequence + 1) is present.
  if (fromSequence + 1 < oldest) return null
  return buf.filter((e) => e.sequence > fromSequence)
}

export function clearBroadcastBuffer(sessionId: string) {
  broadcastBuffers.delete(sessionId)
}

export function broadcastToSession(sessionId: string, data: unknown) {
  if (isSequencedBroadcast(data)) {
    pushBroadcastBuffer(sessionId, data)
  }
  for (const client of wsClients.values()) {
    if (client.sessions.has(sessionId)) {
      client.send({ type: "session_event", sessionId, data })
    }
  }
}

// --- Multiplexed WebSocket client management ---

export function addWsClient(id: string, send: (data: unknown) => void, user?: { email: string; name: string; picture?: string }) {
  wsClients.set(id, { id, send, sessions: new Set(), user })
}

export function removeWsClient(id: string) {
  const client = wsClients.get(id)
  if (!client) return
  // Clean up presence for all watched sessions
  if (client.user) {
    for (const sessionId of client.sessions) {
      removePresenceUser(sessionId, client.user.email)
    }
  }
  wsClients.delete(id)
}

export interface WsSubscribeEntry {
  id: string
  fromSequence?: number
}

export async function wsSubscribe(clientId: string, sessions: readonly WsSubscribeEntry[]) {
  const client = wsClients.get(clientId)
  if (!client) return

  await Promise.all(sessions.map(async ({ id: sessionId, fromSequence }) => {
    client.sessions.add(sessionId)

    if (client.user) {
      addPresenceUser(sessionId, client.user)
    }

    // Cursor-based replay: if the client sent fromSequence, try to replay
    // any buffered events after that cursor. A null result means the cursor
    // is outside the buffer window — the client must fall back to a full
    // snapshot, which we signal with cursor_miss.
    if (typeof fromSequence === "number") {
      const replay = readBroadcastBufferSince(sessionId, fromSequence)
      if (replay === null) {
        client.send({ type: "cursor_miss", sessionId })
      } else {
        for (const entry of replay) {
          client.send({ type: "session_event", sessionId, data: entry.data })
        }
      }
    }

    // Terminal-state replay runs AFTER the buffer replay so message events
    // apply before the status transition they describe.
    const session = await getSessionRecord(sessionId)
    if (session?.status === "complete") {
      client.send({ type: "session_event", sessionId, data: { type: "session_complete", status: "complete" } })
    } else if (session?.status === "errored") {
      client.send({ type: "session_event", sessionId, data: { type: "session_error", status: "errored" } })
    } else if (session?.status === "awaiting_user_input") {
      const questions = await getLastAskUserQuestions(sessionId)
      if (questions) {
        client.send({ type: "session_event", sessionId, data: { type: "ask_user_question", questions } })
      }
    }

    const users = getPresenceUsers(sessionId)
    if (users.length > 0) {
      client.send({ type: "session_event", sessionId, data: { type: "presence", users } })
    }
  }))
}

export function wsUnsubscribe(clientId: string, sessionIds: string[]) {
  const client = wsClients.get(clientId)
  if (!client) return
  for (const sessionId of sessionIds) {
    client.sessions.delete(sessionId)
    if (client.user) {
      removePresenceUser(sessionId, client.user.email)
    }
  }
}

async function autoNameSession(sessionId: string) {
  try {
    const session = await getSessionRecord(sessionId)
    if (!session) return

    // Skip if user has manually renamed the session
    const initialSummary = session.prompt.slice(0, INITIAL_SUMMARY_LENGTH)
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
    log.error("Auto-naming failed", { sessionId, error: err instanceof Error ? err.message : String(err) })
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

/** Collect attached_context system entries appended to the JSONL since the
 *  last user or assistant turn. These are written by `attachSourceToSession`
 *  when the user attaches an email/etc. to an already-running session, but
 *  the Agent SDK's resume flow only sees standard user/assistant messages,
 *  so without inlining, the agent never learns the attached content. */
export function collectPendingAttachments(
  lines: string[],
): Array<{ sourceType: string; sourceId: string; title: string; content: string }> {
  const pending: Array<{ sourceType: string; sourceId: string; title: string; content: string }> = []
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line) continue
    try {
      const msg = JSON.parse(line)
      if (msg.type === "user" || msg.type === "assistant") break
      if (msg.type === "system" && msg.subtype === "attached_context" && typeof msg.content === "string") {
        pending.unshift({
          sourceType: String(msg.sourceType ?? ""),
          sourceId: String(msg.sourceId ?? ""),
          title: String(msg.title ?? ""),
          content: msg.content,
        })
      }
    } catch { /* skip malformed lines */ }
  }
  return pending
}

/** Read a session's JSONL as a line array. Returns [] if the file is
 *  unreadable (missing, permission denied, etc.). */
function readSessionJsonlLines(sessionId: string, cwd?: string): string[] {
  try {
    const content = fs.readFileSync(sessionJsonlPath(sessionId, cwd), "utf-8")
    return content.length > 0 ? content.trim().split("\n") : []
  } catch {
    return []
  }
}

/** Prepend pending attached-context blocks onto a prompt so the agent can read
 *  them. Each block is delimited so it's obvious which content is attached vs.
 *  typed by the user. */
export function inlineAttachments(
  prompt: string,
  attachments: Array<{ sourceType: string; sourceId: string; title: string; content: string }>,
): string {
  if (attachments.length === 0) return prompt
  const blocks = attachments.map((a) => {
    const header = `source=${a.sourceType}:${a.sourceId} title=${JSON.stringify(a.title)}`
    return `<attached_context ${header}>\n${a.content}\n</attached_context>`
  })
  return `${blocks.join("\n\n")}\n\n${prompt}`
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
    /**
     * Skip inserting a row into the `sessions` table and avoid touching/updating
     * its status. Used by background jobs (e.g., entity curation) that track
     * lifecycle externally via `backfill_state`. Session JSONL is still written
     * by the Agent SDK into the CWD's project directory.
     */
    skipDbRecord?: boolean
    /**
     * Called when the background message loop finishes. Receives the session ID
     * and a terminal status. Only invoked when `skipDbRecord` is set — callers
     * without a DB row use this as their "session done" hook to advance their
     * own tracking state.
     */
    onEnd?: (sessionId: string, status: "complete" | "errored", error?: string) => void | Promise<void>
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
  if (sourceContext) log.info("Source context", { preview: sourceContext.slice(0, 100) })
  else log.info("No source context", { type: options?.linkedSourceType, id: options?.linkedSourceId })

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
        artifact: buildArtifactMcpServer(),
      },
      betas: AGENT_SDK_BETAS
    },
  })
  let sequence = 0
  let gotResult = false
  let onEndFired = false
  const fireOnEnd = async (status: "complete" | "errored", error?: string) => {
    if (onEndFired || !options?.skipDbRecord || !options.onEnd) return
    onEndFired = true
    try { await options.onEnd(sessionId!, status, error) }
    catch (err) { log.warn("onEnd callback failed", { sessionId, error: err instanceof Error ? err.message : String(err) }) }
  }

  // Process messages in background
  ;(async () => {
    try {
      for await (const message of q) {
        // Capture session ID from init message
        if (isInitMessage(message)) {
          sessionId = message.session_id

          if (!options?.skipDbRecord) {
            await createSessionRecord(sessionId!, prompt, options)
          }
          runningQueries.set(sessionId!, abortController)

          // Broadcast the user's initial prompt as a synthetic message.
          // The SDK doesn't include it in the stream — it's sent as an argument.
          broadcastToSession(sessionId!, {
            sequence: sequence++,
            message: { type: "user", role: "user", content: prompt },
          })
        }

        if (sessionId) {
          if (!options?.skipDbRecord) {
            await touchSession(sessionId)
          }
          broadcastToSession(sessionId, { sequence, message })
          sequence++
        }

        // Check for result message (session complete)
        if (isResultMessage(message)) {
          gotResult = true
          if (sessionId) {
            if (!options?.skipDbRecord) {
              await updateSessionStatus(sessionId, "complete")
            }
            broadcastToSession(sessionId, {
              type: "session_complete",
              status: "complete",
            })
          }
        }
      }

      if (sessionId) {
        if (!options?.skipDbRecord) {
          await updateSessionStatus(sessionId, "complete")
          autoNameSession(sessionId).catch((err) => log.warn("Failed to auto-name session", { sessionId, error: err instanceof Error ? err.message : String(err) }))
        }
        runningQueries.delete(sessionId)
        pendingQuestions.delete(sessionId)
        await fireOnEnd("complete")
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.error("Session error", { sessionId, error: message })
      if (sessionId) {
        // Don't override "complete" if we already received a result
        if (!gotResult) {
          if (!options?.skipDbRecord) {
            await updateSessionStatus(sessionId, "errored", message)
          }
          broadcastToSession(sessionId, {
            type: "session_error",
            error: message,
          })
        }
        runningQueries.delete(sessionId)
        pendingQuestions.delete(sessionId)
        await fireOnEnd(gotResult ? "complete" : "errored", gotResult ? undefined : message)
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
): Promise<{ started: boolean }> {
  // Reconcile against DB: if the in-memory entry exists but the session is no
  // longer in an active status, the prior iterator failed silently or hung —
  // abort it and replace rather than rejecting forever with 409. Only fetch
  // the record on collision, so the happy path doesn't pay an extra DB query.
  let sessionRecord = runningQueries.has(sessionId) ? await getSessionRecord(sessionId) : null
  if (runningQueries.has(sessionId)) {
    if (isActiveStatus(sessionRecord?.status)) {
      return { started: false }
    }
    log.warn("Clearing stale runningQueries entry", { sessionId, dbStatus: sessionRecord?.status })
    runningQueries.get(sessionId)?.abort()
    runningQueries.delete(sessionId)
    pendingQuestions.delete(sessionId)
  }
  const abortController = new AbortController()
  runningQueries.set(sessionId, abortController)

  type AgentQuery = Awaited<typeof import("@anthropic-ai/claude-agent-sdk")>["query"]
  let q: ReturnType<AgentQuery>
  let sequence: number
  try {
    const { query: agentQuery } = await import("@anthropic-ai/claude-agent-sdk")

    await updateSessionStatus(sessionId, "running")

    // Reuse the record fetched during stale-check if available; otherwise fetch now.
    sessionRecord = sessionRecord ?? await getSessionRecord(sessionId)
    const resumeSourceContext = buildSourceContext(
      sessionRecord?.linked_source_type ?? undefined,
      sessionRecord?.linked_source_id ?? undefined,
    )

    // Find the workspace path where this session's JSONL lives.
    // The CLI stores sessions in ~/.claude/projects/{encoded-cwd}/{sessionId}.jsonl
    const wsPath = findSessionWorkspace(sessionId) || defaultWorkspacePath

    // Single read of the JSONL, shared for sequence (line count) and for
    // scanning attached_context entries to inline into the prompt.
    const jsonlLines = readSessionJsonlLines(sessionId, wsPath)
    sequence = jsonlLines.length

    // Broadcast the user's prompt so it appears in the live transcript. We
    // broadcast the plain user text (what the user actually typed) — the
    // attached-context blocks are inlined into the prompt we send to the SDK
    // only, since they already render as their own chips in the UI.
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

    const promptWithAttachments = inlineAttachments(prompt, collectPendingAttachments(jsonlLines))

    q = agentQuery({
      prompt: promptWithAttachments,
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
          artifact: buildArtifactMcpServer(),
        },
        betas: AGENT_SDK_BETAS
      },
    })
  } catch (err) {
    // Iterator IIFE owns its own cleanup; this catch handles the window before
    // it starts so the runningQueries entry can't leak past the failed setup.
    runningQueries.delete(sessionId)
    pendingQuestions.delete(sessionId)
    const message = err instanceof Error ? err.message : String(err)
    log.error("Session resume setup failed", { sessionId, error: message })
    try {
      await updateSessionStatus(sessionId, "errored", message)
    } catch (statusErr) {
      log.warn("Failed to mark session errored after setup failure", {
        sessionId,
        error: statusErr instanceof Error ? statusErr.message : String(statusErr),
      })
    }
    broadcastToSession(sessionId, { type: "session_error", error: message })
    throw err
  }

  let gotResult = false
  ;(async () => {
    try {
      for await (const message of q) {
        await touchSession(sessionId)
        broadcastToSession(sessionId, { sequence, message })
        sequence++

        if (isResultMessage(message)) {
          gotResult = true
          await updateSessionStatus(sessionId, "complete")
          broadcastToSession(sessionId, {
            type: "session_complete",
            status: "complete",
          })
        }
      }

      await updateSessionStatus(sessionId, "complete")
      broadcastToSession(sessionId, { type: "session_complete", status: "complete" })
      autoNameSession(sessionId).catch((err) => log.warn("Failed to auto-name session", { sessionId, error: err instanceof Error ? err.message : String(err) }))
      runningQueries.delete(sessionId)
      pendingQuestions.delete(sessionId)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log.error("Session resume error", { sessionId, error: message })
      if (!gotResult) {
        await updateSessionStatus(sessionId, "errored", message)
        broadcastToSession(sessionId, {
          type: "session_error",
          error: message,
        })
      }
      runningQueries.delete(sessionId)
      pendingQuestions.delete(sessionId)
    }
  })()

  return { started: true }
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
    log.warn("Failed to append to JSONL", { sessionId, error: (err as Error).message })
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
    await updateSessionStatus(sessionId, "complete")
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
      log.info("Indexed agent sessions", { inserted, updated })
    }
  } catch (err) {
    log.error("Failed to index agent sessions", { error: err instanceof Error ? err.message : String(err) })
  }
}

/** Recover sessions that were running when the server last shut down.
 *  - `running` sessions updated within cutoffMinutes are auto-resumed.
 *  - `awaiting_user_input` sessions are left as-is; `wsSubscribe`
 *    re-delivers the original question when the user reconnects.
 *  - Old stale sessions are marked as errored. */
export async function recoverStaleSessions(cutoffMinutes = 30) {
  const cutoff = new Date(Date.now() - cutoffMinutes * 60 * 1000).toISOString()

  // Find all sessions stuck in an active status
  const staleSessions = await query<{ id: string; status: string; updated_at: string }>(
    `SELECT id, status, updated_at FROM sessions WHERE status = ANY($1::text[])`,
    [SESSION_ACTIVE_STATUSES as readonly string[]],
  )

  if (staleSessions.length === 0) return

  const old = staleSessions.filter((s) => s.updated_at <= cutoff)
  // Only auto-resume running sessions; awaiting_user_input sessions are
  // re-delivered to the user via wsSubscribe when they reconnect.
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
    if (results[i]!.status === "rejected") {
      const session = toResume[i]!
      const reason = (results[i] as PromiseRejectedResult).reason
      log.error("Failed to recover session", { sessionId: session.id, error: reason instanceof Error ? reason.message : String(reason) })
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
      log.warn("Poll error", { error: err instanceof Error ? err.message : String(err) })
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
  const primaryDir = join(projectsDir, encodeWorkspacePath(defaultWorkspacePath))
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

    // Read head — progressively read more if early lines are very large
    let headBytes = Math.min(CHUNK * 4, size)
    const MAX_HEAD = Math.min(512 * 1024, size)
    let headLines: string[] = []
    let allHeadLines: string[] = []
    while (true) {
      const buf = Buffer.allocUnsafe(headBytes)
      const bytesRead = fs.readSync(fd, buf, 0, headBytes, 0)
      allHeadLines = buf.toString("utf-8", 0, bytesRead).split("\n")
      headLines = allHeadLines.slice(0, headCount)
      if (allHeadLines.length > headCount || headBytes >= MAX_HEAD) break
      headBytes = Math.min(headBytes * 2, MAX_HEAD)
    }

    const tailLines: string[] = []
    const tailSize = Math.min(CHUNK * 4, size)
    if (size > tailSize) {
      const tailBuf = Buffer.allocUnsafe(tailSize)
      const tailBytesRead = fs.readSync(fd, tailBuf, 0, tailSize, size - tailSize)
      const allTail = tailBuf.toString("utf-8", 0, tailBytesRead).split("\n")
      tailLines.push(...allTail.slice(-tailCount))
    } else {
      // Small file — all lines were already read in the head pass
      tailLines.push(...allHeadLines.slice(-tailCount))
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
            .filter((b: Record<string, unknown>) => b.type === "text" && !(b.text as string)?.startsWith("<"))
            .map((b: Record<string, unknown>) => b.text as string)
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
    const line = tailLines[i]!
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
    ? [encodeWorkspacePath(wsPath)]
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

  // If workspace path provided, only scan its specific directory and use it
  // as the known cwd for every session — no need to extract from file content.
  const dirEntries: Array<{ name: string; knownCwd: string | null }> = wsPath
    ? [{ name: encodeWorkspacePath(wsPath), knownCwd: wsPath }]
    : fs.readdirSync(projectsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({ name: d.name, knownCwd: null }))

  const results: Array<{
    sessionId: string
    summary: string | null
    lastModified: number
    firstPrompt: string | null
    cwd: string
    project: string
  }> = []

  for (const { name: dirName, knownCwd } of dirEntries) {
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

          const resolvedCwd = knownCwd ?? cwd
          if (!resolvedCwd) continue

          // Skip aborted sessions (file-history-snapshot entries only)
          if (!firstPrompt && !summary) continue

          results.push({
            sessionId: fileName.replace(".jsonl", ""),
            summary,
            lastModified: stat.mtimeMs,
            firstPrompt,
            cwd: resolvedCwd,
            project: projectLabel(resolvedCwd),
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

// Registered workspace paths for reverse-lookup from project label
const registeredPaths: string[] = []
export function registerWorkspacePath(path: string) { registeredPaths.push(resolve(path)) }

/** Find the workspace cwd for a session by checking which project directory contains its JSONL. */
function findSessionWorkspace(sessionId: string): string | null {
  const projectsDir = join(homedir(), ".claude", "projects")
  for (const p of registeredPaths) {
    const encodedDir = encodeWorkspacePath(p)
    const jsonlPath = join(projectsDir, encodedDir, `${sessionId}.jsonl`)
    if (fs.existsSync(jsonlPath)) return p
    // Also check subdirectories (subagent sessions)
    const subDir = join(projectsDir, encodedDir, sessionId)
    if (fs.existsSync(subDir)) return p
  }
  return null
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

/** Route an assistant message's content blocks for transcript emission. The
 *  Agent SDK writes each streaming delta as its own JSONL entry with its own
 *  block subset; only the terminal entry has stop_reason set. We classify by
 *  block type, not by stop_reason, so partial entries with real content aren't
 *  silently dropped.
 *
 *  - thinking: emit later as a standalone assistant message (so the UI renders
 *    it on its own line instead of nested with the next tool call)
 *  - tool_use (Agent): defer and prepend to the next emitted entry so subagent
 *    groupings stay contiguous with their parent Agent call
 *  - text / other tool_use: emit alongside this entry */
function classifyAssistantBlocks(content: unknown): {
  emitBlocks: Array<Record<string, unknown>>
  thinking: Array<Record<string, unknown>>
  agentToolUse: Array<Record<string, unknown>>
} {
  const blocks: Array<Record<string, unknown>> = Array.isArray(content) ? content : []
  const emitBlocks: Array<Record<string, unknown>> = []
  const thinking: Array<Record<string, unknown>> = []
  const agentToolUse: Array<Record<string, unknown>> = []
  for (const block of blocks) {
    if (block?.type === "thinking" && block.thinking) thinking.push(block)
    else if (block?.type === "tool_use" && block.name === "Agent") agentToolUse.push(block)
    else emitBlocks.push(block)
  }
  return { emitBlocks, thinking, agentToolUse }
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
    // Collect Agent tool_use blocks from partial messages for subagent positioning
    let pendingAgentToolUse: Array<Record<string, unknown>> = []

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const msg = JSON.parse(lines[lineIdx]!)

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
          const { emitBlocks, thinking, agentToolUse } = classifyAssistantBlocks(msg.message?.content)
          pendingThinking.push(...thinking)
          pendingAgentToolUse.push(...agentToolUse)

          // Entry contributed only thinking/Agent tool_use — deferred for the
          // next entry with real content.
          if (emitBlocks.length === 0) continue

          for (let ti = 0; ti < pendingThinking.length; ti++) {
            messages.push({
              id: `${lineIdx}-thinking-${ti}`,
              sessionId,
              sequence: lineIdx + (ti + 1) * 0.001,
              type: "assistant",
              message: { type: "assistant", message: { content: [pendingThinking[ti]], stop_reason: "end_turn" } },
              createdAt: msg.timestamp || new Date().toISOString(),
            })
          }
          pendingThinking = []

          const finalContent = pendingAgentToolUse.length > 0
            ? [...pendingAgentToolUse, ...emitBlocks]
            : emitBlocks
          pendingAgentToolUse = []

          msg.message = { ...msg.message, content: finalContent }
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

    // -----------------------------------------------------------------------
    // Merge subagent JSONL files from the subagents/ directory.
    // Each subagent's messages are inserted as a contiguous block right after
    // the Agent tool_result in the main session (preserving grouping).
    // -----------------------------------------------------------------------
    const subagentsDir = join(dirname(sessionFile), sessionId, "subagents")
    if (fs.existsSync(subagentsDir)) {
      // Collect Agent tool_use IDs from the main session in order
      const agentToolUseIds: string[] = []
      for (const m of messages) {
        const content: any[] | undefined =
          (m.message as any)?.message?.content ?? (m.message as any)?.content
        if (!Array.isArray(content)) continue
        for (const block of content) {
          if (block?.type === "tool_use" && block.name === "Agent" && block.id) {
            agentToolUseIds.push(block.id)
          }
        }
      }

      const subFiles = fs.readdirSync(subagentsDir).filter((f: string) => f.endsWith(".jsonl")).sort()

      // Process each subagent and collect its parsed messages
      const subagentBatches: Array<{ toolUseId: string; msgs: Array<Record<string, unknown>> }> = []

      for (let si = 0; si < subFiles.length; si++) {
        const subFile = subFiles[si]!
        const subPath = join(subagentsDir, subFile)
        const subContent = fs.readFileSync(subPath, "utf-8")
        const subLines = subContent.trim().split("\n")
        const agentId = subFile.replace(/^agent-/, "").replace(/\.jsonl$/, "")

        // Read description from companion .meta.json file
        let agentDescription: string | undefined
        const metaPath = join(subagentsDir, `agent-${agentId}.meta.json`)
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
          agentDescription = meta.description
        } catch { /* no meta file */ }

        const batch: Array<Record<string, unknown>> = []
        let subPendingThinking: Array<Record<string, unknown>> = []

        for (const line of subLines) {
          const msg = JSON.parse(line)
          if (!displayTypes.has(msg.type)) continue

          if (msg.type === "assistant") {
            // Subagent JSONLs have no nested subagents, so Agent tool_use blocks
            // (if any) are emitted inline rather than deferred.
            const { emitBlocks, thinking, agentToolUse } = classifyAssistantBlocks(msg.message?.content)
            subPendingThinking.push(...thinking)
            const finalEmit = agentToolUse.length > 0 ? [...agentToolUse, ...emitBlocks] : emitBlocks
            if (finalEmit.length === 0) continue
            msg.message = { ...msg.message, content: [...subPendingThinking, ...finalEmit] }
            subPendingThinking = []
          }

          if (agentDescription) {
            msg.agentDescription = agentDescription
          }

          batch.push({
            id: `${agentId}-${batch.length}`,
            sessionId,
            sequence: 0, // re-numbered below
            type: msg.type,
            message: msg,
            createdAt: msg.timestamp || new Date().toISOString(),
          })
        }

        // Match subagent to its Agent tool_use by order
        const toolUseId = si < agentToolUseIds.length ? agentToolUseIds[si]! : ""
        subagentBatches.push({ toolUseId, msgs: batch })
      }

      // Build toolUseId → message index map in one pass
      const toolUseInsertIdx = new Map<string, number>()
      for (let mi = 0; mi < messages.length; mi++) {
        const content: any[] | undefined =
          (messages[mi]!.message as any)?.message?.content ?? (messages[mi]!.message as any)?.content
        if (!Array.isArray(content)) continue
        for (const block of content) {
          if (block?.type === "tool_use" && block.name === "Agent" && block.id) {
            toolUseInsertIdx.set(block.id, mi + 1)
          }
        }
      }

      // Insert each batch at its Agent tool_use position.
      // Process in reverse so earlier insertions don't shift later indices.
      for (let bi = subagentBatches.length - 1; bi >= 0; bi--) {
        const { toolUseId, msgs } = subagentBatches[bi]!
        if (msgs.length === 0) continue
        const insertIdx = toolUseInsertIdx.get(toolUseId) ?? messages.length
        messages.splice(insertIdx, 0, ...msgs)
      }

      // Re-number sequences
      for (let i = 0; i < messages.length; i++) {
        messages[i]!.sequence = i
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
 * Patch the code of an artifact by tool_use id.
 *
 * Scans the session's JSONL plus any subagent JSONLs for a tool_use block
 * with the given id, then rewrites the field that holds the artifact source:
 *
 * - render_output / mcp__render_output__render_output → input.data.code (or input.data if it's a string)
 * - create_file / mcp__artifact__create_file → input.file_text
 * - Write → input.content
 *
 * Returns false if no matching tool_use block is found, or if the block's
 * tool name is not one we know how to patch.
 */
export async function patchArtifactCode(sessionId: string, toolUseId: string, code: string): Promise<boolean> {
  const agentSession = await findAgentSession(sessionId)
  if (!agentSession) return false

  const sessionFile = sessionJsonlPath(sessionId, agentSession.cwd)
  if (patchArtifactInFile(sessionFile, toolUseId, code)) return true

  // Fall back to subagent JSONLs
  const subagentsDir = join(dirname(sessionFile), sessionId, "subagents")
  if (!fs.existsSync(subagentsDir)) return false
  const subFiles = fs.readdirSync(subagentsDir).filter((f) => f.endsWith(".jsonl"))
  for (const subFile of subFiles) {
    if (patchArtifactInFile(join(subagentsDir, subFile), toolUseId, code)) return true
  }
  return false
}

/** Apply the patch to a single JSONL file in place. Returns true if a matching block was patched. */
function patchArtifactInFile(filePath: string, toolUseId: string, code: string): boolean {
  let content: string
  try {
    content = fs.readFileSync(filePath, "utf-8")
  } catch {
    return false
  }
  const lines = content.trim().split("\n")
  for (let i = 0; i < lines.length; i++) {
    // Fast string pre-filter: tool_use ids are unique, so lines that don't
    // contain the id literally can't match — skip JSON.parse for them.
    if (!lines[i]!.includes(toolUseId)) continue
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(lines[i]!)
    } catch {
      continue
    }
    if (!patchToolUseBlock(msg, toolUseId, code)) continue
    lines[i] = JSON.stringify(msg)
    fs.writeFileSync(filePath, lines.join("\n") + "\n")
    return true
  }
  return false
}

/** Mutate a tool_use block matching toolUseId. Returns true if modified. */
function patchToolUseBlock(msg: Record<string, unknown>, toolUseId: string, code: string): boolean {
  const msgInner = msg.message as Record<string, unknown> | undefined
  const content = msgInner?.content ?? msg.content
  if (!Array.isArray(content)) return false
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type !== "tool_use" || block.id !== toolUseId) continue
    const name = block.name as string
    const input = block.input as Record<string, unknown> | undefined
    if (!input) return false

    if (RENDER_OUTPUT_NAMES.has(name)) {
      if (typeof input.data === "string") {
        input.data = code
      } else if (input.data && typeof input.data === "object") {
        ;(input.data as Record<string, unknown>).code = code
      } else {
        return false
      }
      return true
    }
    if (CREATE_FILE_NAMES.has(name)) {
      input.file_text = code
      return true
    }
    if (name === "Write") {
      input.content = code
      return true
    }
    return false
  }
  return false
}
