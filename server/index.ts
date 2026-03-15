import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { getCookie } from "hono/cookie"
import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { homedir } from "os"
import { gmailRoutes } from "./routes/gmail.js"
import { notionRoutes } from "./routes/notion.js"
import { sessionRoutes } from "./routes/sessions.js"
import { webhookRoutes } from "./routes/webhooks.js"
import { preferencesRoutes } from "./routes/preferences.js"
import { authRoutes, SESSION_COOKIE } from "./routes/auth.js"
import { pluginRoutes } from "./routes/plugins.js"
import { panelRoutes } from "./routes/panels.js"
import { connectionRoutes } from "./routes/connections.js"
import { initializeDatabase } from "./db/schema.js"
import { loadCredentials } from "./lib/credentials.js"
import { setWorkspacePath, setCredentialProxy } from "./lib/session-manager.js"
import { createCredentialProxy } from "./lib/credential-proxy.js"
import { resolveCredential } from "./lib/vault.js"
import { getSession } from "./lib/auth.js"
import { syncPropertyOptions, syncCalendarPropertyOptions } from "./lib/notion.js"
import { pruneExpired } from "./lib/cache.js"
import { loadPlugins } from "./lib/plugin-loader.js"
import { loadPanels } from "./lib/panel-registry.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load inbox .env (OAuth config for sign-in)
config({ path: resolve(__dirname, "../.env") })

// Parse --workspace arg
function getWorkspacePath(): string {
  const args = process.argv.slice(2)
  const wsIndex = args.indexOf("--workspace")
  if (wsIndex !== -1 && args[wsIndex + 1]) {
    const raw = args[wsIndex + 1]
    return raw.startsWith("~") ? raw.replace("~", homedir()) : resolve(raw)
  }
  // Default workspace
  return resolve(homedir(), "Github/hammies/hammies-agent")
}

const workspacePath = getWorkspacePath()
console.log(`Workspace: ${workspacePath}`)

// Load workspace credentials (.env) for Gmail/Notion API access
loadCredentials(workspacePath)
setWorkspacePath(workspacePath)

// Initialize database
initializeDatabase()

// Start credential proxy (non-blocking)
createCredentialProxy({
  resolveToken: async (sessionToken, integration) => {
    // Look up the user from the session token, then resolve their credential
    const session = getSession(sessionToken)
    if (!session) return null
    return resolveCredential(session.user.email, workspacePath, integration)
  },
})
  .then((proxy) => {
    setCredentialProxy(proxy)
    console.log(`Credential proxy ready on port ${proxy.port}`)
  })
  .catch((err) => console.error("Failed to start credential proxy:", err))

// Create app
const app = new Hono()
app.use("*", cors())
app.use("*", logger())

// Auth routes (unprotected)
app.route("/api/auth", authRoutes)

app.get("/api/health", (c) => c.json({ status: "ok", workspace: workspacePath }))

// Auth middleware — protect all other /api routes
app.use("/api/*", async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token || !getSession(token)) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  await next()
})

// Protected routes
app.route("/api/gmail", gmailRoutes)
app.route("/api/notion", notionRoutes)
app.route("/api/sessions", sessionRoutes)
app.route("/api/webhooks", webhookRoutes)
app.route("/api/preferences", preferencesRoutes)
app.route("/api/plugins", pluginRoutes)
app.route("/api/panels", panelRoutes)
app.route("/api/connections", connectionRoutes)

// Error handler
app.onError((err, c) => {
  console.error("Server error:", err)
  return c.json({ error: err.message }, 500)
})

const port = parseInt(process.env.PORT || "3002", 10)

serve({ fetch: app.fetch, port }, () => {
  console.log(`Server running on http://localhost:${port}`)
  // Prune expired cache entries on startup
  pruneExpired()
  // Sync Notion property options on startup (non-blocking)
  syncPropertyOptions().catch((err) => console.warn("Failed to sync Notion options:", err.message))
  syncCalendarPropertyOptions().catch((err) => console.warn("Failed to sync Calendar options:", err.message))
  // Load source plugins and workflow panel schemas (non-blocking)
  process.env.WORKSPACE_PATH = workspacePath
  loadPlugins(workspacePath).catch((err) => console.warn("Failed to load plugins:", err.message))
  loadPanels(workspacePath).catch((err) => console.warn("Failed to load panels:", err.message))
})
