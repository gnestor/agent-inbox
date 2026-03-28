import { query } from "./db/pool.js"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { getCookie } from "hono/cookie"
import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { homedir } from "os"
import { existsSync } from "fs"
import { sessionRoutes } from "./routes/sessions.js"
import { webhookRoutes } from "./routes/webhooks.js"
import { preferencesRoutes } from "./routes/preferences.js"
import { authRoutes, SESSION_COOKIE } from "./routes/auth.js"
import { pluginRoutes, mountPluginRoutes } from "./routes/plugins.js"
import { panelRoutes } from "./routes/panels.js"
import { connectionRoutes } from "./routes/connections.js"
import { contextRoutes } from "./routes/context.js"
import { initializeDatabase, closePool } from "./db/pool.js"
import { loadCredentials, setDefaultWorkspaceId } from "./lib/credentials.js"
import { setWorkspacePath, setCredentialProxy, indexAllAgentSessions, recoverStaleSessions, watchProjectsDir } from "./lib/session-manager.js"
import { registerWorkspaces, resolveActiveWorkspace } from "./lib/workspace-scanner.js"
import type { WorkspaceContext } from "./lib/workspace-context.js" // used in AppBindings below
import { workspaceRoutes, WORKSPACE_COOKIE } from "./routes/workspaces.js"
import { createCredentialProxy } from "./lib/credential-proxy.js"
import { resolveCredential, getUserCredential, storeUserCredential, seedWorkspaceCredentials } from "./lib/vault.js"
import { getSession } from "./lib/auth.js"
import { pruneExpired } from "./lib/cache.js"
import { loadPlugins, registerPlugin } from "./lib/plugin-loader.js"
import { loadPanels } from "./lib/panel-registry.js"
import { gmailPlugin } from "../plugins/gmail/plugin.js"
import { corePlugin } from "../plugins/core/plugin.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load inbox .env (OAuth config for sign-in)
config({ path: resolve(__dirname, "../.env") })

// Validate VAULT_SECRET
if (!process.env.VAULT_SECRET || process.env.VAULT_SECRET.length < 64) {
  console.warn(
    "WARNING: VAULT_SECRET not set or too short. Credential vault will not work.\n" +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  )
}

// Parse workspace paths from CLI args or env vars
// Priority: --workspaces > --workspace > WORKSPACES env > WORKSPACE env > default
function getWorkspacePaths(): string[] {
  const resolvePath = (raw: string) =>
    raw.startsWith("~") ? raw.replace("~", homedir()) : resolve(raw.trim())

  const args = process.argv.slice(2)

  // CLI: --workspaces path1,path2
  const wsIndex = args.indexOf("--workspaces")
  if (wsIndex !== -1 && args[wsIndex + 1]) {
    return args[wsIndex + 1].split(",").map(resolvePath)
  }

  // CLI: --workspace path (legacy single)
  const legacyIndex = args.indexOf("--workspace")
  if (legacyIndex !== -1 && args[legacyIndex + 1]) {
    return [resolvePath(args[legacyIndex + 1])]
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
console.log(`Workspaces: ${workspacePaths.join(", ")}`)

// Initialize database
await initializeDatabase()

// Register each workspace path
const registeredWorkspaces = await registerWorkspaces(workspacePaths)

// Legacy compat — set default workspace path for callers not yet migrated
setWorkspacePath(workspacePaths[0])

// Load credentials and seed vault for each workspace
import { getWorkspaceName } from "./lib/session-manager.js"
import { buildEnvToIntegrationMap } from "./lib/integrations.js"
const envToIntegrationMap = buildEnvToIntegrationMap()

for (const ws of registeredWorkspaces) {
  const wsEnv = loadCredentials(ws.path, ws.id)
  await seedWorkspaceCredentials(ws.id, wsEnv, envToIntegrationMap)
}

// Set the first workspace as default for backward compat
if (registeredWorkspaces.length > 0) {
  setDefaultWorkspaceId(registeredWorkspaces[0].id)
}

// Auto-refresh an OAuth access token using the stored refresh token.
// Currently only QBO needs this — access tokens expire after 1 hour.
async function maybeRefreshToken(
  userEmail: string,
  integration: string,
): Promise<string | null> {
  const cred = await getUserCredential(userEmail, integration)
  if (!cred) return null

  const isExpired = cred.expiresAt && new Date(cred.expiresAt) <= new Date(Date.now() + 60_000)
  if (!isExpired || !cred.refreshToken) return cred.token

  if (integration === "quickbooks") {
    try {
      const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(
            `${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`
          ).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: cred.refreshToken,
        }),
      })
      const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string }
      if (!res.ok) {
        console.error("QBO token refresh failed:", data.error_description)
        return cred.token // Return stale token; QBO will 401 and user must reconnect
      }
      const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString()
      await storeUserCredential(userEmail, integration, {
        token: data.access_token!,
        refreshToken: data.refresh_token ?? cred.refreshToken,
        scopes: cred.scopes,
        expiresAt,
      })
      console.log("QBO access token refreshed, expires:", expiresAt)
      return data.access_token!
    } catch (err) {
      console.error("QBO token refresh error:", err)
      return cred.token
    }
  }

  return cred.token
}

// Start credential proxy (non-blocking)
createCredentialProxy({
  resolveToken: async (sessionToken, integration) => {
    const session = await getSession(sessionToken)
    if (!session) return null
    // For integrations with expiring access tokens, auto-refresh if needed
    const refreshed = await maybeRefreshToken(session.user.email, integration)
    if (refreshed !== null) return refreshed
    return resolveCredential(session.user.email, workspacePaths[0], integration)
  },
})
  .then((proxy) => {
    setCredentialProxy(proxy)
    console.log(`Credential proxy ready on port ${proxy.port}`)
  })
  .catch((err) => console.error("Failed to start credential proxy:", err))

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

// Create app
const app = new Hono<AppBindings>()
app.use("*", cors())
app.use("*", logger())

// Auth routes (unprotected)
app.route("/api/auth", authRoutes)

app.get("/api/health", (c) => c.json({ status: "ok", workspaces: workspacePaths }))

// Auth middleware — protect all other /api routes and set user context
// Skip auth for plugin component serving (components are code, not user data)
app.use("/api/*", async (c, next) => {
  // Plugin component routes don't need auth — srcDoc iframes have null origin (no cookies)
  if (c.req.path.match(/^\/api\/[^/]+\/components\/[^/]+$/)) {
    return next()
  }
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

  await next()
})

// Register built-in plugins (before workspace plugins are loaded)
registerPlugin(gmailPlugin)
registerPlugin(corePlugin)

// Protected routes (static routes first, plugin catch-all last)
app.route("/api/workspaces", workspaceRoutes)
app.route("/api/sessions", sessionRoutes)
app.route("/api/webhooks", webhookRoutes)
app.route("/api/preferences", preferencesRoutes)
app.route("/api/panels", panelRoutes)
app.route("/api/connections", connectionRoutes)
app.route("/api/context", contextRoutes)
// Plugin routes last — /:pluginId/* is a catch-all that must not shadow static routes
app.route("/api", pluginRoutes)

// User profiles — look up by email for transcript author avatars
app.get("/api/users", async (c) => {
  const emails = c.req.query("emails")
  if (!emails) return c.json({ users: [] })
  const list = emails.split(",").map((e) => e.trim()).filter(Boolean)
  if (list.length === 0) return c.json({ users: [] })
  const placeholders = list.map((_, i) => `$${i + 1}`).join(",")
  const rows = await query(`SELECT email, name, picture FROM users WHERE email IN (${placeholders})`, list)
  return c.json({ users: rows })
})

// Error handler
app.onError((err, c) => {
  console.error("Server error:", err)
  return c.json({ error: err.message }, 500)
})

// Mount built-in plugin custom routes (gmail attachments, notion options, etc.)
// Must be before the SPA fallback so /api/gmail/* routes aren't caught by /*
mountPluginRoutes(app)

// Serve production build if dist/ exists
const distPath = resolve(__dirname, "../dist")
if (existsSync(distPath)) {
  app.use("/*", serveStatic({ root: "./dist" }))
  // SPA fallback — serve index.html for all non-API routes
  app.get("/*", serveStatic({ path: "./dist/index.html" }))
}

const port = parseInt(process.env.PORT || "3002", 10)

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on http://localhost:${port}`)
  // Prune expired cache entries on startup
  pruneExpired().catch((err: unknown) => console.warn("Failed to prune cache:", err))
  // Index all agent SDK sessions into DB (non-blocking), then watch for new ones
  indexAllAgentSessions()
    .then(() => watchProjectsDir(workspacePaths.slice(0, 1)))
    .catch((err: unknown) => console.warn("Failed to index sessions:", err))
  // Auto-resume sessions that were running when the server last shut down
  recoverStaleSessions().catch((err: unknown) => console.warn("Failed to recover stale sessions:", err))
  // Load workspace plugins and workflow panel schemas (non-blocking)
  process.env.WORKSPACE_PATH = workspacePaths[0]
  Promise.all(
    registeredWorkspaces.map((ws) =>
      loadPlugins(ws.path, ws.id).catch((err) => console.warn(`Failed to load plugins for ${ws.id}:`, err.message))
    )
  ).then(() => {
    mountPluginRoutes(app)
  })
  if (registeredWorkspaces.length > 0) {
    loadPanels(registeredWorkspaces[0].path).catch((err) => console.warn("Failed to load panels:", err.message))
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
