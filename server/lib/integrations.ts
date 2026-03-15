export interface IntegrationConfig {
  id: string
  name: string
  icon: string // emoji or lucide icon name
  scope: "user" | "workspace"
  authType: "oauth2" | "api_key"
  /** Env vars this integration depends on. Used by migration script and future plugin system. */
  envVars: {
    /** Primary credential env var (token/key) */
    credential: string
    /** Additional env vars needed (config, IDs, etc.) */
    config?: string[]
  }
  // OAuth2 fields (only if authType === "oauth2")
  authUrl?: string
  tokenUrl?: string
  scopes?: string[]
  clientIdEnv?: string
  clientSecretEnv?: string
}

export const INTEGRATIONS: IntegrationConfig[] = [
  // --- User-scoped (OAuth) ---
  {
    id: "google",
    name: "Google",
    icon: "mail",
    scope: "user",
    authType: "oauth2",
    envVars: {
      credential: "GOOGLE_REFRESH_TOKEN",
      config: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    },
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  },
  {
    id: "pinterest",
    name: "Pinterest",
    icon: "pin",
    scope: "user",
    authType: "oauth2",
    envVars: {
      credential: "PINTEREST_ACCESS_TOKEN",
      config: ["PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET", "PINTEREST_REFRESH_TOKEN"],
    },
    authUrl: "https://www.pinterest.com/oauth/",
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    scopes: ["boards:read", "pins:read"],
    clientIdEnv: "PINTEREST_CLIENT_ID",
    clientSecretEnv: "PINTEREST_CLIENT_SECRET",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    icon: "receipt",
    scope: "user",
    authType: "oauth2",
    envVars: {
      credential: "QUICKBOOKS_REFRESH_TOKEN",
      config: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QUICKBOOKS_ENVIRONMENT", "QUICKBOOKS_REALM_ID"],
    },
    authUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    scopes: ["com.intuit.quickbooks.accounting"],
    clientIdEnv: "QUICKBOOKS_CLIENT_ID",
    clientSecretEnv: "QUICKBOOKS_CLIENT_SECRET",
  },

  // --- Workspace-scoped (API keys, managed via CLI) ---
  // Notion, Slack, GitHub: using workspace API keys for now.
  // OAuth config preserved for when per-user OAuth is set up.
  {
    id: "notion",
    name: "Notion",
    icon: "book-open",
    scope: "workspace",
    authType: "api_key",
    envVars: { credential: "NOTION_API_TOKEN" },
  },
  {
    id: "slack",
    name: "Slack",
    icon: "message-square",
    scope: "workspace",
    authType: "api_key",
    envVars: { credential: "SLACK_BOT_TOKEN" },
  },
  {
    id: "github",
    name: "GitHub",
    icon: "github",
    scope: "workspace",
    authType: "api_key",
    envVars: { credential: "GITHUB_TOKEN" },
  },
  {
    id: "shopify",
    name: "Shopify",
    icon: "shopping-bag",
    scope: "workspace",
    authType: "api_key",
    envVars: {
      credential: "SHOPIFY_API_TOKEN",
      config: ["SHOPIFY_STORE_DOMAIN"],
    },
  },
  {
    id: "air",
    name: "Air",
    icon: "image",
    scope: "workspace",
    authType: "api_key",
    envVars: {
      credential: "AIR_API_KEY",
      config: ["AIR_WORKSPACE_ID"],
    },
  },
  {
    id: "gorgias",
    name: "Gorgias",
    icon: "headphones",
    scope: "workspace",
    authType: "api_key",
    envVars: {
      credential: "GORGIAS_API_TOKEN",
      config: ["GORGIAS_DOMAIN", "GORGIAS_EMAIL"],
    },
  },
  {
    id: "meta",
    name: "Meta Ads",
    icon: "megaphone",
    scope: "workspace",
    authType: "api_key",
    envVars: {
      credential: "META_ACCESS_TOKEN",
      config: ["META_AD_ACCOUNT_ID"],
    },
  },
  {
    id: "facebook",
    name: "Facebook",
    icon: "globe",
    scope: "workspace",
    authType: "api_key",
    envVars: { credential: "FACEBOOK_ACCESS_TOKEN" },
  },
  {
    id: "instagram",
    name: "Instagram",
    icon: "camera",
    scope: "workspace",
    authType: "api_key",
    envVars: { credential: "INSTAGRAM_ACCESS_TOKEN" },
  },
  {
    id: "klaviyo",
    name: "Klaviyo",
    icon: "mail",
    scope: "workspace",
    authType: "api_key",
    envVars: { credential: "KLAVIYO_PRIVATE_KEY" },
  },
  {
    id: "google-ads",
    name: "Google Ads",
    icon: "bar-chart",
    scope: "workspace",
    authType: "api_key",
    envVars: {
      credential: "GOOGLE_ADS_DEVELOPER_TOKEN",
      config: ["GOOGLE_ADS_CUSTOMER_ID"],
    },
  },
  {
    id: "shippo",
    name: "Shippo",
    icon: "truck",
    scope: "workspace",
    authType: "api_key",
    envVars: { credential: "SHIPPO_API_TOKEN" },
  },
  {
    id: "happy-returns",
    name: "Happy Returns",
    icon: "undo-2",
    scope: "workspace",
    authType: "api_key",
    envVars: { credential: "HAPPY_RETURNS_API_KEY" },
  },
  {
    id: "observable",
    name: "Observable",
    icon: "line-chart",
    scope: "workspace",
    authType: "api_key",
    envVars: { credential: "OBSERVABLE_API_TOKEN" },
  },
]

export function getIntegration(id: string): IntegrationConfig | undefined {
  return INTEGRATIONS.find((i) => i.id === id)
}

export function getOAuthIntegrations(): IntegrationConfig[] {
  return INTEGRATIONS.filter((i) => i.authType === "oauth2")
}

/**
 * Build env var → integration mapping from the registry.
 * Used by migration script to auto-detect credentials.
 */
export function buildEnvToIntegrationMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const integration of INTEGRATIONS) {
    map[integration.envVars.credential] = integration.id
  }
  return map
}
