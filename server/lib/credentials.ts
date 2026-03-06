import { config } from "dotenv"
import { resolve } from "path"

let credentials: Record<string, string> = {}

export function loadCredentials(workspacePath: string) {
  const result = config({ path: resolve(workspacePath, ".env") })
  if (result.error) {
    console.warn(`Warning: Could not load .env from ${workspacePath}: ${result.error.message}`)
  }
  credentials = result.parsed || {}
  return credentials
}

export function getCredential(key: string): string {
  const value = credentials[key]
  if (!value) throw new Error(`Missing credential: ${key}`)
  return value
}

export function getCredentials() {
  return credentials
}

/**
 * Returns env vars to pass to the Agent SDK, excluding ANTHROPIC_API_KEY
 * so that Claude Code uses the user's subscription instead of API credits.
 */
export function getAgentEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(credentials)) {
    if (key === "ANTHROPIC_API_KEY") continue
    env[key] = value
  }
  return env
}

/**
 * Returns a Google OAuth access token, refreshing if needed.
 */
let cachedAccessToken: { token: string; expiry: number } | null = null

export async function getGoogleAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiry - 60_000) {
    return cachedAccessToken.token
  }

  const clientId = getCredential("GOOGLE_CLIENT_ID")
  const clientSecret = getCredential("GOOGLE_CLIENT_SECRET")
  const refreshToken = getCredential("GOOGLE_REFRESH_TOKEN")

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google token refresh failed: ${text}`)
  }

  const data = await res.json()
  cachedAccessToken = {
    token: data.access_token,
    expiry: Date.now() + (data.expires_in || 3600) * 1000,
  }
  return cachedAccessToken.token
}

/**
 * Returns the Notion API token.
 */
export function getNotionToken(): string {
  return getCredential("NOTION_API_TOKEN")
}
