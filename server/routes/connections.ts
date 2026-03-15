import { Hono } from "hono"
import { getCookie } from "hono/cookie"
import { SESSION_COOKIE } from "./auth.js"
import { getSession } from "../lib/auth.js"
import { getIntegration, INTEGRATIONS } from "../lib/integrations.js"
import {
  storeUserCredential,
  listUserCredentials,
  deleteUserCredential,
  listWorkspaceCredentials,
} from "../lib/vault.js"
import { getWorkspacePath } from "../lib/session-manager.js"
import { randomBytes } from "crypto"

export const connectionRoutes = new Hono()

// In-memory OAuth state store (short-lived, keyed by random state param)
const oauthStates = new Map<
  string,
  { userEmail: string; integration: string; origin: string; expiresAt: number }
>()

// Clean expired states periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of oauthStates) {
    if (val.expiresAt < now) oauthStates.delete(key)
  }
}, 60_000)

function getCurrentUser(c: any): { email: string; name: string } | null {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const session = getSession(token)
  return session?.user ? { email: session.user.email, name: session.user.name } : null
}

/**
 * GET /connections — list all integrations with connection status
 */
connectionRoutes.get("/", (c) => {
  const user = getCurrentUser(c)
  if (!user) return c.json({ error: "Unauthorized" }, 401)

  const userCreds = listUserCredentials(user.email)
  const workspaceCreds = listWorkspaceCredentials(getWorkspacePath())

  const connectedUserIntegrations = new Set(userCreds.map((cr) => cr.integration))
  const connectedWorkspaceIntegrations = new Set(workspaceCreds.map((cr) => cr.integration))

  const integrations = INTEGRATIONS.map((config) => ({
    id: config.id,
    name: config.name,
    icon: config.icon,
    scope: config.scope,
    authType: config.authType,
    connected:
      config.scope === "user"
        ? connectedUserIntegrations.has(config.id)
        : connectedWorkspaceIntegrations.has(config.id),
  }))

  return c.json({ integrations })
})

/**
 * GET /connections/connect/:integration — start OAuth flow
 * Redirects the user to the OAuth provider's authorization URL.
 */
connectionRoutes.get("/connect/:integration", (c) => {
  const user = getCurrentUser(c)
  if (!user) return c.json({ error: "Unauthorized" }, 401)

  const integrationId = c.req.param("integration")
  const config = getIntegration(integrationId)
  if (!config) return c.json({ error: "Unknown integration" }, 404)
  if (config.authType !== "oauth2") {
    return c.json({ error: "This integration does not support OAuth" }, 400)
  }
  if (!config.authUrl || !config.clientIdEnv) {
    return c.json({ error: "OAuth not configured for this integration" }, 400)
  }

  const clientId = process.env[config.clientIdEnv]
  if (!clientId) {
    return c.json({ error: `${config.clientIdEnv} not configured` }, 500)
  }

  // Derive the frontend origin (Vite proxy strips the Origin header,
  // so the frontend passes it as a query param)
  const origin = c.req.query("origin")
    || c.req.header("origin")
    || c.req.header("referer")?.replace(/\/[^/]*$/, "")
    || new URL(c.req.url).origin

  // Generate state param for CSRF protection
  const state = randomBytes(24).toString("hex")
  oauthStates.set(state, {
    userEmail: user.email,
    integration: integrationId,
    origin,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 min
  })
  const redirectUri = `${origin}/api/connections/connect/${integrationId}/callback`

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  })

  if (config.scopes?.length) {
    params.set("scope", config.scopes.join(" "))
  }

  // Provider-specific params
  if (integrationId === "notion") {
    params.set("owner", "user")
  }
  if (integrationId === "google") {
    params.set("access_type", "offline")
    params.set("prompt", "consent")
  }

  return c.redirect(`${config.authUrl}?${params}`)
})

/**
 * GET /connections/connect/:integration/callback — OAuth callback
 * Exchanges the authorization code for tokens and stores them.
 */
connectionRoutes.get("/connect/:integration/callback", async (c) => {
  const integrationId = c.req.param("integration")
  const code = c.req.query("code")
  const state = c.req.query("state")
  const error = c.req.query("error")

  if (error) {
    // Redirect back to settings with error
    return c.redirect(`/settings/integrations?error=${encodeURIComponent(error)}`)
  }

  if (!code || !state) {
    return c.json({ error: "Missing code or state" }, 400)
  }

  const oauthState = oauthStates.get(state)
  if (!oauthState || oauthState.expiresAt < Date.now()) {
    return c.json({ error: "Invalid or expired state" }, 400)
  }
  oauthStates.delete(state)

  if (oauthState.integration !== integrationId) {
    return c.json({ error: "Integration mismatch" }, 400)
  }

  const config = getIntegration(integrationId)
  if (!config || !config.tokenUrl || !config.clientIdEnv || !config.clientSecretEnv) {
    return c.json({ error: "Integration not configured" }, 500)
  }

  const clientId = process.env[config.clientIdEnv]!
  const clientSecret = process.env[config.clientSecretEnv]!
  // Use the origin stored during the connect step (must match exactly)
  const redirectUri = `${oauthState.origin}/api/connections/connect/${integrationId}/callback`

  // Exchange code for token
  let tokenBody: URLSearchParams | string
  let tokenHeaders: Record<string, string> = {}

  if (integrationId === "notion") {
    // Notion uses Basic auth for token exchange
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
    tokenHeaders = {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    }
    tokenBody = JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    })
  } else {
    tokenHeaders = { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" }
    tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString()
  }

  const tokenRes = await fetch(config.tokenUrl, {
    method: "POST",
    headers: tokenHeaders,
    body: tokenBody,
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    console.error(`OAuth token exchange failed for ${integrationId}:`, text)
    return c.redirect(`/settings/integrations?error=${encodeURIComponent("Token exchange failed")}`)
  }

  const tokenData = await tokenRes.json()

  // Extract token (different providers use different field names)
  const accessToken =
    tokenData.access_token ||
    tokenData.authed_user?.access_token || // Slack v2
    tokenData.bot?.bot_access_token

  if (!accessToken) {
    console.error("No access_token in response:", tokenData)
    return c.redirect(`/settings/integrations?error=${encodeURIComponent("No access token returned")}`)
  }

  storeUserCredential(oauthState.userEmail, integrationId, {
    token: accessToken,
    refreshToken: tokenData.refresh_token,
    scopes: tokenData.scope || config.scopes?.join(","),
    expiresAt: tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : undefined,
  })

  // Redirect back to settings
  return c.redirect(`/settings/integrations?connected=${integrationId}`)
})

/**
 * DELETE /connections/:integration — disconnect an integration
 */
connectionRoutes.delete("/:integration", (c) => {
  const user = getCurrentUser(c)
  if (!user) return c.json({ error: "Unauthorized" }, 401)

  const integrationId = c.req.param("integration")
  const config = getIntegration(integrationId)
  if (!config) return c.json({ error: "Unknown integration" }, 404)
  if (config.scope !== "user") {
    return c.json({ error: "Workspace integrations cannot be disconnected from the UI" }, 403)
  }

  deleteUserCredential(user.email, integrationId)
  return c.json({ ok: true })
})
