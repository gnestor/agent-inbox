import { query } from "./db/pool.js"
import { vaultQuery, vaultQueryOne, vaultExecute, getVaultPool } from "./db/pool.js"
import { serve } from "@hono/node-server"
import { createNodeWebSocket } from "@hono/node-ws"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { parseAllowedOrigins, createCorsMiddleware } from "@hammies/auth/server"
import { logger } from "hono/logger"
import { createLogger, runWithRequestContext } from "@hammies/frontend/lib/serverLogger"
import { randomUUID } from "crypto"
import { csrfProtection } from "./lib/csrf.js"
import { runHealthChecks, isHealthy } from "./lib/health.js"
import { parseJson } from "./lib/schemas.js"
import {
  CONTRACT_VERSION,
  InboxClientMessageSchema,
  decodeContract,
} from "@hammies/contracts/session"
import {
  EnvBooleanSchema,
  EnvPortSchema,
  decodeEnvironment,
} from "@hammies/contracts/env"
import { z } from "zod"

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
import { telemetryRoutes } from "./routes/telemetry.js"
import { initializeDatabase, closePool } from "./db/pool.js"
import { loadCredentials, setDefaultWorkspaceId, getCredentials } from "./lib/credentials.js"
import { setWorkspacePath, setCredentialProxy, indexAllAgentSessions, recoverStaleSessions, watchProjectsDir, addWsClient, removeWsClient, wsSubscribe, wsUnsubscribe, registerWorkspacePath } from "./lib/session-manager.js"
import { registerWorkspaces, resolveActiveWorkspace } from "./lib/workspace-scanner.js"
import type { WorkspaceContext } from "./lib/workspace-context.js" // used in AppBindings below
import { workspaceRoutes, WORKSPACE_COOKIE } from "./routes/workspaces.js"
import { createCredentialProxy, type ResolvedCredential } from "./lib/credential-proxy.js"
import {
  resolveCredential,
  seedWorkspaceCredentials,
  configureCredentialStore,
  maybeRefreshToken,
  resolveWorkspaceAccessToken,
  resolveConfigVar,
} from "./lib/vault.js"
import { registerPluginIntegrations, discoverWorkspacePluginIntegrations, getIntegration } from "./lib/integrations.js"
import { pluginAssetRoutes, inboxPluginAssetUrl } from "./routes/plugin-assets.js"
import { startCredentialKeepAlive, pgAdvisoryLockAdapter } from "@hammies/auth/server"
import { getSession } from "./lib/auth.js"
import { loadPlugins, loadBuiltinPlugins } from "./lib/plugin-loader.js"
import { watchPlugins } from "./lib/plugin-watcher.js"
import { loadPanels } from "./lib/panel-registry.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load workspace-root .env first (shared secrets like AUTH_SECRET), then
// inbox-local .env (overrides + inbox-specific config like GOOGLE_CLIENT_ID,
// VAULT_SECRET).
config({ path: resolve(__dirname, "../../../.env") })
config({ path: resolve(__dirname, "../.env"), override: true })

const inboxEnvironment = decodeEnvironment(
  "inbox",
  z.object({
    VAULT_SECRET: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
    WORKSPACES: z.string().min(1).optional(),
    WORKSPACE: z.string().min(1).optional(),
    INBOX_PORT: EnvPortSchema.optional(),
    PORT: EnvPortSchema.optional(),
    CREDENTIAL_KEEPALIVE: EnvBooleanSchema.optional(),
    DISABLE_BACKFILL: EnvBooleanSchema.optional(),
    SLACK_SIGNING_SECRET: z.string().min(16).optional(),
    INBOX_WEBHOOK_SECRET: z.string().min(32).optional(),
  }),
  process.env,
)

// Validate VAULT_SECRET
if (!inboxEnvironment.VAULT_SECRET) {
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
  if (inboxEnvironment.WORKSPACES) {
    return inboxEnvironment.WORKSPACES.split(",").map(resolvePath)
  }

  // Env: WORKSPACE=path (legacy single)
  if (inboxEnvironment.WORKSPACE) {
    return [resolvePath(inboxEnvironment.WORKSPACE)]
  }

  // Default workspace: packages/agent in the monorepo
  return [resolve(import.meta.dirname, "../../agent")]
}

const workspacePaths = getWorkspacePaths()
log.info("Workspaces", { paths: workspacePaths.map(p => basename(p)) })

// Initialize database
await initializeDatabase()

// Point the shared @hammies/auth credential vault at the STUDIO DB (its single
// canonical home — STUDIO_DATABASE_URL), NOT inbox's own DATABASE_URL. The vault
// is a separate database from inbox's tables; binding it here to the same DB
// studio + the data-pipeline broker use means one shared row + one advisory lock
// keyspace, so concurrent refreshers can't fork the QBO refresh-token chain.
// Must run before any vault function (credential proxy, connections routes).
// pgAdvisoryLockAdapter runs the whole locked critical section on ONE dedicated
// connection (the scoped store), so token refresh never needs a second pooled
// connection — deadlock-free under contention. Shared with studio so the lock
// keyspace is identical by construction (one implementation, not two copies).
configureCredentialStore({
  query: vaultQuery,
  queryOne: vaultQueryOne,
  execute: vaultExecute,
  withAdvisoryLock: pgAdvisoryLockAdapter(getVaultPool()),
})

// Converge onto the plugin-aggregated registry — the SAME path Studio runs at
// boot. Scan each workspace's plugins for their `studio.integrations` manifest
// and register them into the shared @hammies/auth registry. Inbox reads the
// registry (connections UI, credential proxy) but does NOT run Studio's plugin
// loader, so without this a plugin-declared integration is invisible here — the
// coupling that pinned every integration to the central built-in list. Runs
// BEFORE the keep-alive and the env→vault seeder (below) so both cover
// plugin-declared integrations too. Inbox serves each plugin's icon assets from
// its `dir` (see `pluginAssetRoutes` below), so it passes `inboxPluginAssetUrl`
// — an asset-path icon becomes a served iconUrl instead of the generic
// fallback. Best-effort: a plugin misconfiguration is logged, never fatal —
// email/tasks must still boot.
const pluginAssetDirs = new Map<string, string>()
try {
  const pluginIntegrations = discoverWorkspacePluginIntegrations(workspacePaths)
  registerPluginIntegrations(pluginIntegrations, { assetUrl: inboxPluginAssetUrl })
  for (const p of pluginIntegrations) if (p.dir) pluginAssetDirs.set(p.name, p.dir)
  log.info("Plugin integrations registered", {
    plugins: pluginIntegrations.length,
    integrations: pluginIntegrations.reduce((n, p) => n + p.integrations.length, 0),
  })
} catch (err) {
  log.error("Plugin integration registration failed", { error: err instanceof Error ? err.message : String(err) })
}

// Keep the OAuth refresh-token chains alive on the always-on host so they never
// idle into expiry. Opt-in (CREDENTIAL_KEEPALIVE=1) so it doesn't fire from
// dev/test server boots and hit live OAuth providers.
if (inboxEnvironment.CREDENTIAL_KEEPALIVE) {
  startCredentialKeepAlive()
}

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

// OAuth refresh + advisory-lock serialization moved to @hammies/auth
// (`maybeRefreshToken`). The lock primitive is supplied by inbox via the
// `withAdvisoryLock` on the credential store adapter configured above.

createCredentialProxy({
  resolveCredential: async (sessionToken, integration): Promise<ResolvedCredential | null> => {
    const session = await getSession(sessionToken)
    if (!session) return null

    const config = getIntegration(integration)
    const workspaceId = registeredWorkspaces[0]?.id ?? ""

    // Workspace-scope integrations resolve through resolveWorkspaceAccessToken,
    // which is type-aware: it mints a short-lived scoped access token from the
    // stored service-account key for a `service_account` row (e.g. `google`'s
    // Analytics/Search Console SA — the raw stored value there is a JSON blob,
    // never a usable Bearer token), refreshes a stored OAuth token, or returns
    // a static key — the proxy never has to branch on auth type itself. This
    // mirrors Studio's own credential proxy (packages/studio/src/server/
    // credentials/proxy.ts `resolveForProxy`). User-scope integrations (Gmail,
    // QuickBooks, …) stay on the per-user OAuth refresh path, falling back to
    // the legacy vault lookup for a non-OAuth-refreshable user credential.
    const token =
      config?.scope === "workspace"
        ? await resolveWorkspaceAccessToken(workspaceId, integration)
        : (await maybeRefreshToken(session.user.email, integration)) ??
          (await resolveCredential(session.user.email, workspaceId, integration))
    if (!token) return null

    // Gorgias Basic auth needs the email alongside the API token
    if (integration === "gorgias") {
      const email = getCredentials().GORGIAS_EMAIL
      if (email) return { token, extras: { email } }
    }

    // Config-backed extra headers (e.g. Google Ads' `developer-token`),
    // resolved inside this trusted process so the raw value never rides in
    // the agent's environment.
    const proxyHeaders = config?.proxy?.headers
    if (proxyHeaders?.length) {
      const extras: Record<string, string> = {}
      for (const { valueEnv } of proxyHeaders) {
        const value = await resolveConfigVar(session.user.email, workspaceId, integration, valueEnv)
        if (value) extras[valueEnv] = value
      }
      return { token, extras }
    }

    return { token }
  },
})
  .then((proxy) => {
    setCredentialProxy(proxy)
  })
  .catch((err: unknown) => log.error("Failed to start credential proxy", { error: err instanceof Error ? err.message : String(err) }))

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
const ALLOWED_ORIGINS = parseAllowedOrigins("http://localhost:5175")

// Create app
const app = new Hono<AppBindings>()
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app })
app.use("*", createCorsMiddleware(ALLOWED_ORIGINS))
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

// Telemetry endpoints (unprotected) — heartbeats + crash reports may come
// from partially-loaded or post-crash tabs without a valid session.
app.route("/api/telemetry", telemetryRoutes)

app.get("/api/health", async (c) => {
  const checks = await runHealthChecks(workspacePaths)
  const ok = isHealthy(checks)
  return c.json(
    { status: ok ? "ok" : "degraded", timestamp: new Date().toISOString(), ...checks },
    ok ? 200 : 503,
  )
})

// The credential broker is now single-homed on Studio (:5181) — the single
// broker host (consolidation Phase 3). Inbox no longer mounts it; the Meltano
// taps and the laptop finance skills all read credentials from Studio's mount.
// Inbox keeps only the in-process keep-alive above (refreshes the OAuth chains
// on this always-on host); it never served credentials to itself over HTTP.

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
      wsSend({ contractVersion: CONTRACT_VERSION, type: "connected", clientId })
    },
    onMessage(evt) {
      try {
        const raw = typeof evt.data === "string" ? evt.data : evt.data.toString()
        const msg = decodeContract(
          InboxClientMessageSchema,
          parseJson(raw),
          { contract: "inbox-session-client-wire@1", source: clientId },
        )
        if (msg.type === "subscribe") {
          // Accept both shapes:
          //   legacy:  { sessionIds: string[] }
          //   current: { sessions: Array<{ id: string; fromSequence?: number }> }
          // The legacy form means "no cursor" — we behave as before.
          if (msg.sessions) {
            wsSubscribe(clientId, msg.sessions)
          } else if (msg.sessionIds) {
            wsSubscribe(clientId, msg.sessionIds.map((id) => ({ id })))
          }
        } else if (msg.type === "unsubscribe") {
          wsUnsubscribe(clientId, msg.sessionIds)
        } else if (msg.type === "ping") {
          wsSend?.({ contractVersion: CONTRACT_VERSION, type: "pong" })
        }
      } catch (error: unknown) {
        log.warn("Rejected WebSocket client message", {
          clientId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
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
// Plugin icon assets — before the /:pluginId/* catch-all so it isn't shadowed.
app.route("/api", pluginAssetRoutes(pluginAssetDirs))
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

// INBOX_PORT is the inbox-specific override (mirrors Studio's STUDIO_PORT) so a
// second instance from a worktree can run beside the main checkout's server;
// PORT stays supported for generic hosts. Vite's /api proxy reads the same var.
const port = inboxEnvironment.INBOX_PORT ?? inboxEnvironment.PORT ?? 3002

// Load workspace plugins before starting the server
for (const ws of registeredWorkspaces) {
  await loadPlugins(ws.path, ws.id).catch((err: unknown) => log.warn("Failed to load plugins", { workspaceId: ws.id, error: err instanceof Error ? err.message : String(err) }))
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
    if (!inboxEnvironment.DISABLE_BACKFILL) {
      import("./lib/context-backfill-scheduler.js")
        .then(({ scheduleContextBackfill }) => scheduleContextBackfill(firstRegistered.path, firstRegistered.id))
        .catch((err: unknown) => log.warn("Failed to schedule context backfill", { error: err instanceof Error ? err.message : String(err) }))
    }
    loadPanels(firstRegistered.path).catch((err: unknown) => log.warn("Failed to load panels", { error: err instanceof Error ? err.message : String(err) }))
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
