import { getDb } from "./db/schema.js"
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
import { initializeDatabase } from "./db/schema.js"
import { loadCredentials } from "./lib/credentials.js"
import { setWorkspacePath, setCredentialProxy, indexAllAgentSessions, recoverStaleSessions } from "./lib/session-manager.js"
import { createCredentialProxy } from "./lib/credential-proxy.js"
import { resolveCredential, getUserCredential, storeUserCredential, seedWorkspaceCredentials } from "./lib/vault.js"
import { getSession } from "./lib/auth.js"
import { syncPropertyOptions, syncCalendarPropertyOptions } from "./lib/notion.js"
import { pruneExpired } from "./lib/cache.js"
import { loadPlugins, registerPlugin } from "./lib/plugin-loader.js"
import { loadPanels } from "./lib/panel-registry.js"
import { gmailPlugin } from "./plugins/gmail-plugin.js"
import { notionTasksPlugin } from "./plugins/notion-tasks-plugin.js"
import { notionCalendarPlugin } from "./plugins/notion-calendar-plugin.js"

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

// Parse --workspace arg
function getWorkspacePath(): string {
  const args = process.argv.slice(2)
  const wsIndex = args.indexOf("--workspace")
  if (wsIndex !== -1 && args[wsIndex + 1]) {
    const raw = args[wsIndex + 1]
    return raw.startsWith("~") ? raw.replace("~", homedir()) : resolve(raw)
  }
  // Default workspace: packages/agent in the monorepo
  return resolve(import.meta.dirname, "../../agent")
}

const workspacePath = getWorkspacePath()
console.log(`Workspace: ${workspacePath}`)

// Load workspace credentials (.env) for Gmail/Notion API access
const workspaceEnv = loadCredentials(workspacePath)
setWorkspacePath(workspacePath)

// Initialize database and seed any missing workspace credentials from .env
initializeDatabase()
import { getWorkspaceName } from "./lib/session-manager.js"
import { buildEnvToIntegrationMap } from "./lib/integrations.js"
seedWorkspaceCredentials(getWorkspaceName(), workspaceEnv, buildEnvToIntegrationMap())

// Auto-refresh an OAuth access token using the stored refresh token.
// Currently only QBO needs this — access tokens expire after 1 hour.
async function maybeRefreshToken(
  userEmail: string,
  integration: string,
): Promise<string | null> {
  const cred = getUserCredential(userEmail, integration)
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
      storeUserCredential(userEmail, integration, {
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
    const session = getSession(sessionToken)
    if (!session) return null
    // For integrations with expiring access tokens, auto-refresh if needed
    const refreshed = await maybeRefreshToken(session.user.email, integration)
    if (refreshed !== null) return refreshed
    return resolveCredential(session.user.email, workspacePath, integration)
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
  }
}

// Create app
const app = new Hono<AppBindings>()
app.use("*", cors())
app.use("*", logger())

// Auth routes (unprotected)
app.route("/api/auth", authRoutes)

app.get("/api/health", (c) => c.json({ status: "ok", workspace: workspacePath }))

// Auth middleware — protect all other /api routes and set user context
app.use("/api/*", async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return c.json({ error: "Unauthorized" }, 401)
  const session = getSession(token)
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  c.set("user", session.user)
  c.set("userEmail", session.user.email)
  c.set("userName", session.user.name)
  c.set("sessionToken", token)
  await next()
})

// Register built-in plugins (before workspace plugins are loaded)
registerPlugin(gmailPlugin)
registerPlugin(notionTasksPlugin)
registerPlugin(notionCalendarPlugin)

// Protected routes (static routes first, plugin catch-all last)
app.route("/api/sessions", sessionRoutes)
app.route("/api/webhooks", webhookRoutes)
app.route("/api/preferences", preferencesRoutes)
app.route("/api/panels", panelRoutes)
app.route("/api/connections", connectionRoutes)
// Plugin routes last — /:pluginId/* is a catch-all that must not shadow static routes
app.route("/api", pluginRoutes)

// User profiles — look up by email for transcript author avatars
app.get("/api/users", (c) => {
  const emails = c.req.query("emails")
  if (!emails) return c.json({ users: [] })
  const list = emails.split(",").map((e) => e.trim()).filter(Boolean)
  if (list.length === 0) return c.json({ users: [] })
  const placeholders = list.map(() => "?").join(",")
  const rows = getDb().prepare(`SELECT email, name, picture FROM users WHERE email IN (${placeholders})`).all(...list)
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
  pruneExpired()
  // Index all agent SDK sessions into DB (non-blocking)
  indexAllAgentSessions().catch((err: unknown) => console.warn("Failed to index sessions:", err))
  // Auto-resume sessions that were running when the server last shut down
  recoverStaleSessions().catch((err: unknown) => console.warn("Failed to recover stale sessions:", err))
  // Sync Notion property options on startup (non-blocking)
  syncPropertyOptions().catch((err) => console.warn("Failed to sync Notion options:", err.message))
  syncCalendarPropertyOptions().catch((err) => console.warn("Failed to sync Calendar options:", err.message))
  // Load workspace plugins and workflow panel schemas (non-blocking)
  process.env.WORKSPACE_PATH = workspacePath
  loadPlugins(workspacePath).then(() => {
    // Mount any workspace plugin custom routes
    mountPluginRoutes(app)
  }).catch((err) => console.warn("Failed to load plugins:", err.message))
  loadPanels(workspacePath).catch((err) => console.warn("Failed to load panels:", err.message))
})

// Graceful shutdown — close server and unref timers so tsx can restart cleanly
function shutdown() {
  server.close()
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
