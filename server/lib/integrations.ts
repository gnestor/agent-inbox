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
  {
    id: "notion",
    name: "Notion",
    icon: "book-open",
    scope: "user",
    authType: "oauth2",
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    clientIdEnv: "NOTION_OAUTH_CLIENT_ID",
    clientSecretEnv: "NOTION_OAUTH_CLIENT_SECRET",
  },
  {
    id: "slack",
    name: "Slack",
    icon: "message-square",
    scope: "user",
    authType: "oauth2",
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["channels:read", "channels:history", "chat:write", "users:read"],
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
  },
  {
    id: "github",
    name: "GitHub",
    icon: "github",
    scope: "user",
    authType: "oauth2",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:org"],
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
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
