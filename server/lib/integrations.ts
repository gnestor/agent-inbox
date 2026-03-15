export interface IntegrationConfig {
  id: string
  name: string
  icon: string // emoji or lucide icon name
  scope: "user" | "workspace"
  authType: "oauth2" | "api_key"
  // OAuth2 fields (only if authType === "oauth2")
  authUrl?: string
  tokenUrl?: string
  scopes?: string[]
  clientIdEnv?: string // env var name for client ID
  clientSecretEnv?: string
}

export const INTEGRATIONS: IntegrationConfig[] = [
  // Notion, Slack, GitHub: using workspace API keys for now.
  // OAuth config preserved for when per-user OAuth is set up.
  {
    id: "notion",
    name: "Notion",
    icon: "book-open",
    scope: "workspace",
    authType: "api_key",
  },
  {
    id: "slack",
    name: "Slack",
    icon: "message-square",
    scope: "workspace",
    authType: "api_key",
  },
  {
    id: "github",
    name: "GitHub",
    icon: "github",
    scope: "workspace",
    authType: "api_key",
  },
  {
    id: "google",
    name: "Google",
    icon: "mail",
    scope: "user",
    authType: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  },
  {
    id: "shopify",
    name: "Shopify",
    icon: "shopping-bag",
    scope: "workspace",
    authType: "api_key",
  },
  {
    id: "air",
    name: "Air",
    icon: "image",
    scope: "workspace",
    authType: "api_key",
  },
]

export function getIntegration(id: string): IntegrationConfig | undefined {
  return INTEGRATIONS.find((i) => i.id === id)
}

export function getOAuthIntegrations(): IntegrationConfig[] {
  return INTEGRATIONS.filter((i) => i.authType === "oauth2")
}
