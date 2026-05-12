import { query } from "./db/pool.js"
import { serve } from "@hono/node-server"
import { createNodeWebSocket } from "@hono/node-ws"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { createLogger, runWithRequestContext } from "./lib/logger.js"
import { randomUUID } from "crypto"
import { csrfProtection } from "./lib/csrf.js"
import { runHealthChecks, isHealthy } from "./lib/health.js"

const log = createLogger("server")
import { getCookie } from "hono/cookie"
import { config } from "dotenv"
import { resolve, dirname, basename } from "path"
import { fileURLToPath } from "url"
import { homedir } from "os"
import { existsSync } from "fs"
import { sessionRoutes } from "./routes/sessions.js"
import { webhookRoutes } from "./routes/webhooks.js"
import { preferencesRoutes } from "./routes/preferences.js"
import { authRoutes, SESSION_COOKIE } from "./routes/auth.js"
import { pluginRoutes, mountPluginRoutes } from "./routes/plugins.js"
import { backfillRoutes } from "./routes/backfill.js"
import { panelRoutes } from "./routes/panels.js"
import { connectionRoutes } from "./routes/connections.js"
import { initializeDatabase, closePool } from "./db/pool.js"
import { loadCredentials, setDefaultWorkspaceId, getCredentials } from "./lib/credentials.js"
import { setWorkspacePath, setCredentialProxy, indexAllAgentSessions, recoverStaleSessions, watchProjectsDir, addWsClient, removeWsClient, wsSubscribe, wsUnsubscribe, registerWorkspacePath } from "./lib/session-manager.js"
import { registerWorkspaces, resolveActiveWorkspace } from "./lib/workspace-scanner.js"
import type { WorkspaceContext } from "./lib/workspace-context.js" // used in AppBindings below
import { workspaceRoutes, WORKSPACE_COOKIE } from "./routes/workspaces.js"
import { createCredentialProxy, type ResolvedCredential } from "./lib/credential-proxy.js"
import { resolveCredential, getUserCredential, storeUserCredential, seedWorkspaceCredentials, type StoredCredential } from "./lib/vault.js"
import { getIntegration } from "./lib/integrations.js"
import { getSession } from "./lib/auth.js"
import { loadPlugins, loadBuiltinPlugins } from "./lib/plugin-loader.js"
import { watchPlugins } from "./lib/plugin-watcher.js"
import { loadPanels } from "./lib/panel-registry.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load workspace-root .env first (shared secrets like JWT_SECRET), then
// inbox-local .env (overrides + inbox-specific config like GOOGLE_CLIENT_ID,
// VAULT_SECRET).
config({ path: resolve(__dirname, "../../../.env") })
config({ path: resolve(__dirname, "../.env"), override: true })

// Validate VAULT_SECRET
if (!process.env.VAULT_SECRET || process.env.VAULT_SECRET.length < 64) {
  log.warn("VAULT_SECRET not set or too short — credential vault will not work")
}

// Parse workspace paths from CLI args or env vars
// Priority: --workspaces > --workspace > WORKSPACES env > WORKSPACE env > default
function getWorkspacePaths(): string[] {
  const resolvePath = (raw: string) =>
    raw.startsWith("~") ? raw.replace("~", homedir()) : resolve(raw.trim())

  const args = process.argv.slice(2)

  // CLI: --workspaces path1,path2
  const wsIndex = args.indexOf("--workspaces")
  const wsArg = wsIndex !== -1 ? args[wsIndex + 1] : undefined
  if (wsArg) {
    return wsArg.split(",").map(resolvePath)
  }

  // CLI: --workspace path (legacy single)
  const legacyIndex = args.indexOf("--workspace")
  const legacyArg = legacyIndex !== -1 ? args[legacyIndex + 1] : undefined
  if (legacyArg) {
    return [resolvePath(legacyArg)]
  }

  // Env: WORKSPACES=path1,path2
  if (process.env.WORKSPACES) {
    return process.env.WORKSPACES.split(",").map(resolvePath)
  }

  // Env: WORKSPACE=path (legacy single)
  if (process.env.WORKSPACE) {
    return [resolvePath(process.env.WORKSPACE)]
  }

  // Default workspace: packages/agent in the monorepo
  return [resolve(import.meta.dirname, "../../agent")]
}

const workspacePaths = getWorkspacePaths()
log.info("Workspaces", { paths: workspacePaths.map(p => basename(p)) })

// Initialize database
await initializeDatabase()

// Register each workspace path
const registeredWorkspaces = await registerWorkspaces(workspacePaths)

// Legacy compat — set default workspace path for callers not yet migrated
setWorkspacePath(workspacePaths[0]!)
// Register all workspace paths for reverse-lookup during session resume
for (const p of workspacePaths) registerWorkspacePath(p)

// Load credentials and seed vault for each workspace
import { getWorkspaceName } from "./lib/session-manager.js"
import { buildEnvToIntegrationMap } from "./lib/integrations.js"
const envToIntegrationMap = buildEnvToIntegrationMap()

for (const ws of registeredWorkspaces) {
  const wsEnv = loadCredentials(ws.path, ws.id)
  await seedWorkspaceCredentials(ws.id, wsEnv, envToIntegrationMap)
}

// Set the first workspace as default for backward compat
const firstWorkspace = registeredWorkspaces[0]
if (firstWorkspace) {
  setDefaultWorkspaceId(firstWorkspace.id)
}

/**
 * Generic OAuth access token refresh using IntegrationConfig metadata.
 * Reads tokenUrl, tokenAuthMethod, clientIdEnv, clientSecretEnv from the
 * integration registry so each provider doesn't need a bespoke block.
 */
async function refreshOAuthAccessToken(
  userEmail: string,
  integration: string,
  refreshToken: string,
  existing: StoredCredential,
): Promise<string> {
  const config = getIntegration(integration)
  if (!config?.tokenUrl || !config.clientIdEnv || !config.clientSecretEnv) return existing.token

  const clientId = process.env[config.clientIdEnv]
  const clientSecret = process.env[config.clientSecretEnv]
  if (!clientId || !clientSecret) return existing.token

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Accept": "application/json",
  }
  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }

  if (config.tokenAuthMethod === "basic") {
    headers["Authorization"] = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
  } else {
    body.client_id = clientId
    body.client_secret = clientSecret
  }

  try {
    const res = await fetch(config.tokenUrl, {
      method: "POST",
      headers,
      body: new URLSearchParams(body),
    })
    const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number }
    if (!res.ok) {
      console.error(`${config.name} token refresh failed:`, data)
      return existing.token
    }
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString()
    await storeUserCredential(userEmail, integration, {
      token: data.access_token!,
      refreshToken: data.refresh_token ?? refreshToken,
      scopes: existing.scopes,
      expiresAt,
    })
    console.log(`${config.name} access token refreshed, expires: ${expiresAt}`)
    return data.access_token!
  } catch (err) {
    console.error(`${config.name} token refresh error:`, err)
    return existing.token
  }
}

async function maybeRefreshToken(
  userEmail: string,
  integration: string,
): Promise<string | null> {
  const cred = await getUserCredential(userEmail, integration)
  if (!cred) return null

  const isExpired = cred.expiresAt && new Date(cred.expiresAt) <= new Date(Date.now() + 60_000)
  if (!isExpired || !cred.refreshToken) return cred.token

  return refreshOAuthAccessToken(userEmail, integration, cred.refreshToken, cred)
}

createCredentialProxy({
  resolveCredential: async (sessionToken, integration): Promise<ResolvedCredential | null> => {
    const session = await getSession(sessionToken)
    if (!session) return null

    const refreshed = await maybeRefreshToken(session.user.email, integration)
    const token = refreshed ?? await resolveCredential(session.user.email, workspacePaths[0]!, integration)
    if (!token) return null

    // Gorgias Basic auth needs the email alongside the API token
    if (integration === "gorgias") {
      const email = getCredentials().GORGIAS_EMAIL
      if (email) return { token, extras: { email } }
    }

    return { token }
  },
})
  .then((proxy) => {
    setCredentialProxy(proxy)
  })
  .catch((err) => log.error("Failed to start credential proxy", { error: err instanceof Error ? err.message : String(err) }))

// Typed Hono app bindings — Phase 3+ routes use c.get("userEmail") etc.
type AppBindings = {
  Variables: {
    user: { name: string; email: string; picture?: string }
    userEmail: string
    userName: string
    sessionToken: string
    workspace: WorkspaceContext
  }
}

// Allowed origins for CORS and CSRF checks
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS?.split(",") ?? ["http://localhost:5175"])
  .map((s) => s.trim())
  .filter(Boolean)

// Create app
const app = new Hono<AppBindings>()
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app })
app.use("*", cors({
  origin: (origin) => (origin && ALLOWED_ORIGINS.includes(origin) ? origin : null),
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
  allowHeaders: ["Content-Type", "X-Request-Id"],
}))
app.use("*", logger())

// Request correlation — every log call inside a handler gets requestId auto-injected
app.use("*", async (c, next) => {
  const requestId = c.req.header("x-request-id") || randomUUID()
  c.header("x-request-id", requestId)
  const userEmail = c.get("userEmail") as string | undefined
  await runWithRequestContext({ requestId, ...(userEmail ? { userEmail } : {}) }, () => next())
})

// CSRF origin validation — scoped to /api/* state-changing requests
// Exempts webhooks (third-party POSTs) and the OAuth callback (redirect from provider)
app.use("/api/*", csrfProtection({
  allowedOrigins: ALLOWED_ORIGINS,
  exemptPaths: ["/api/webhooks", "/api/connections/connect"],
}))

// Auth routes (unprotected)
app.route("/api/auth", authRoutes)

app.get("/api/health", async (c) => {
  const checks = await runHealthChecks(workspacePaths)
  const ok = isHealthy(checks)
  return c.json(
    { status: ok ? "ok" : "degraded", timestamp: new Date().toISOString(), ...checks },
    ok ? 200 : 503,
  )
})

// Auth middleware — protect all other /api routes and set user context
app.use("/api/*", async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return c.json({ error: "Unauthorized" }, 401)
  const session = await getSession(token)
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  c.set("user", session.user)
  c.set("userEmail", session.user.email)
  c.set("userName", session.user.name)
  c.set("sessionToken", token)

  // Resolve active workspace from cookie (shared helper handles fallback + auto-claim)
  const ws = await resolveActiveWorkspace(session.user.email, getCookie(c, WORKSPACE_COOKIE))
  if (ws) {
    c.set("workspace", { id: ws.id, name: ws.name, path: ws.path, role: ws.role })
  }

  // Augment request context with userEmail now that auth is resolved
  const reqId = c.res.headers.get("x-request-id") || randomUUID()
  await runWithRequestContext(
    { requestId: reqId, userEmail: session.user.email },
    () => next(),
  )
})

// Load built-in plugins from plugins/ directory
await loadBuiltinPlugins(resolve(__dirname, "../plugins"))

// Multiplexed WebSocket — single connection for all session events
app.get("/api/ws", upgradeWebSocket((c) => {
  const user = c.get("user") as { name: string; email: string; picture?: string } | undefined
  const clientId = crypto.randomUUID()
  let wsSend: ((data: unknown) => void) | null = null

  return {
    onOpen(_evt, ws) {
      wsSend = (data: unknown) => {
        try { ws.send(JSON.stringify(data)) } catch { /* client gone */ }
      }
      addWsClient(clientId, wsSend, user)
      wsSend({ type: "connected", clientId })
    },
    onMessage(evt) {
      try {
        const raw = typeof evt.data === "string" ? evt.data : evt.data.toString()
        const msg = JSON.parse(raw)
        if (msg.type === "subscribe") {
          // Accept both shapes:
          //   legacy:  { sessionIds: string[] }
          //   current: { sessions: Array<{ id: string; fromSequence?: number }> }
          // The legacy form means "no cursor" — we behave as before.
          if (Array.isArray(msg.sessions)) {
            wsSubscribe(clientId, msg.sessions)
          } else if (Array.isArray(msg.sessionIds)) {
            wsSubscribe(clientId, msg.sessionIds.map((id: string) => ({ id })))
          }
        } else if (msg.type === "unsubscribe" && Array.isArray(msg.sessionIds)) {
          wsUnsubscribe(clientId, msg.sessionIds)
        } else if (msg.type === "ping") {
          wsSend?.({ type: "pong" })
        }
      } catch { /* ignore parse errors */ }
    },
    onClose() {
      removeWsClient(clientId)
    },
  }
}))

// Protected routes (static routes first, plugin catch-all last)
app.route("/api/workspaces", workspaceRoutes)
app.route("/api/sessions", sessionRoutes)
app.route("/api/webhooks", webhookRoutes)
app.route("/api/preferences", preferencesRoutes)
app.route("/api/panels", panelRoutes)
app.route("/api/connections", connectionRoutes)
app.route("/api/backfill", backfillRoutes)
// Plugin routes last — /:pluginId/* is a catch-all that must not shadow static routes
app.route("/api", pluginRoutes)

// User profiles — look up by email for transcript author avatars
app.get("/api/users", async (c) => {
  const emails = c.req.query("emails")
  if (!emails) return c.json({ users: [] })
  const list = emails.split(",").map((e) => e.trim()).filter(Boolean)
  if (list.length === 0) return c.json({ users: [] })
  const placeholders = list.map((_, i) => `$${i + 1}`).join(",")
  const rows = await query<{ email: string; name: string; picture: string | null }>(`SELECT email, name, picture FROM users WHERE email IN (${placeholders})`, list)
  return c.json({ users: rows })
})

// Error handler
app.onError((err, c) => {
  log.error("Server error", { error: err.message })
  return c.json({ error: err.message }, 500)
})

// Mount built-in plugin custom routes (must be before the SPA fallback)
mountPluginRoutes(app)

// Serve production build if dist/ exists
const distPath = resolve(__dirname, "../dist")
if (existsSync(distPath)) {
  app.use("/*", serveStatic({ root: "./dist" }))
  // SPA fallback — serve index.html for all non-API routes
  app.get("/*", serveStatic({ path: "./dist/index.html" }))
}

const port = parseInt(process.env.PORT || "3002", 10)

// Load workspace plugins before starting the server
for (const ws of registeredWorkspaces) {
  await loadPlugins(ws.path, ws.id).catch((err) => log.warn("Failed to load plugins", { workspaceId: ws.id, error: err.message }))
}
mountPluginRoutes(app)

const server = serve({ fetch: app.fetch, port }, () => {
  log.info("Server running", { url: `http://localhost:${port}` })
  injectWebSocket(server)
  watchPlugins(registeredWorkspaces, app)
  // Index all agent SDK sessions into DB (non-blocking)
  indexAllAgentSessions()
    .then(() => watchProjectsDir())
    .catch((err: unknown) => log.warn("Failed to index sessions", { error: err instanceof Error ? err.message : String(err) }))
  // Auto-resume sessions that were running when the server last shut down
  recoverStaleSessions().catch((err: unknown) => log.warn("Failed to recover stale sessions", { error: err instanceof Error ? err.message : String(err) }))
  process.env.WORKSPACE_PATH = workspacePaths[0]
  const firstRegistered = registeredWorkspaces[0]
  if (firstRegistered) {
    // Schedule periodic context backfill (raw indexing + curated updates)
    // Set DISABLE_BACKFILL=1 to skip scheduling (useful when running multiple server instances)
    if (!process.env.DISABLE_BACKFILL) {
      import("./lib/context-backfill-scheduler.js")
        .then(({ scheduleContextBackfill }) => scheduleContextBackfill(firstRegistered.path, firstRegistered.id))
        .catch((err: unknown) => log.warn("Failed to schedule context backfill", { error: err instanceof Error ? err.message : String(err) }))
    }
    loadPanels(firstRegistered.path).catch((err) => log.warn("Failed to load panels", { error: err.message }))
  }
})

// Graceful shutdown — close server, pool, and unref timers so tsx can restart cleanly
async function shutdown() {
  server.close()
  await closePool()
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

// Keep the server alive through transient network blips (e.g. Tailscale
// reconnect drops idle Postgres connections). Without these guards, an async
// pg error in any route would crash the process and force a manual restart.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason)
})
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err)
})
