# Integrations

How to add and manage integrations (data source connections) in the workflow app.

## Architecture

Integrations are defined in `server/lib/integrations.ts`. Each integration declares:

```typescript
interface IntegrationConfig {
  id: string           // unique identifier (e.g., "notion", "shopify")
  name: string         // display name
  icon: string         // lucide icon name (rendered as emoji in UI)
  scope: "user" | "workspace"
  authType: "oauth2" | "api_key"
  envVars: {
    credential: string   // primary env var name (e.g., "NOTION_API_TOKEN")
    config?: string[]    // additional env vars (e.g., ["SHOPIFY_STORE_DOMAIN"])
  }
  // OAuth-only fields
  authUrl?: string
  tokenUrl?: string
  scopes?: string[]
  clientIdEnv?: string
  clientSecretEnv?: string
}
```

### Scopes

- **User-scoped** (`scope: "user"`): Each user connects their own account via OAuth. Tokens stored per-user in `user_credentials` table, encrypted with AES-256-GCM.
- **Workspace-scoped** (`scope: "workspace"`): Shared API keys managed by admin via CLI. Stored in `workspace_credentials` table. Shown as read-only "Managed by admin" in the UI.

## Adding a new integration

### Workspace integration (API key)

1. Add the config to `INTEGRATIONS` array in `server/lib/integrations.ts`:

```typescript
{
  id: "new-service",
  name: "New Service",
  icon: "plug",              // lucide icon name
  scope: "workspace",
  authType: "api_key",
  envVars: {
    credential: "NEW_SERVICE_API_KEY",
    config: ["NEW_SERVICE_DOMAIN"],  // optional config vars
  },
},
```

2. Add the env var to the workspace `.env` file and `packages/agent/.env.example`.

3. Run the migration to store it in the vault:

```bash
cd packages/inbox
npm run migrate:credentials -- ../agent
```

Or with explicit mapping:

```bash
npm run migrate:credentials -- ../agent --new-service=NEW_SERVICE_API_KEY
```

### User integration (OAuth)

1. Register an OAuth app with the provider and get client ID + secret.

2. Add the config to `INTEGRATIONS` array:

```typescript
{
  id: "new-service",
  name: "New Service",
  icon: "plug",
  scope: "user",
  authType: "oauth2",
  envVars: {
    credential: "NEW_SERVICE_ACCESS_TOKEN",
    config: ["NEW_SERVICE_CLIENT_ID", "NEW_SERVICE_CLIENT_SECRET"],
  },
  authUrl: "https://new-service.com/oauth/authorize",
  tokenUrl: "https://new-service.com/oauth/token",
  scopes: ["read", "write"],
  clientIdEnv: "NEW_SERVICE_CLIENT_ID",
  clientSecretEnv: "NEW_SERVICE_CLIENT_SECRET",
},
```

3. Add `NEW_SERVICE_CLIENT_ID` and `NEW_SERVICE_CLIENT_SECRET` to `packages/inbox/.env`.

4. Register the redirect URI with the provider:
   - Local dev: `http://localhost:5175/api/connections/connect/new-service/callback`
   - Production: `https://<hostname>/api/connections/connect/new-service/callback`

5. The integration will automatically appear in the "User" section of Settings > Integrations with a "Connect" button.

## Credential storage

- **Vault**: All tokens are encrypted with AES-256-GCM using `VAULT_SECRET` (64-char hex, set in `packages/inbox/.env`).
- **DB tables**: `user_credentials` (per user+integration) and `workspace_credentials` (per workspace+integration).
- **Credential proxy**: Agent subprocesses never see raw tokens. The HTTPS proxy intercepts outbound API calls and injects `Authorization` headers from the vault.

## Migration script

```bash
# Auto-detect from registry (uses envVars.credential mapping)
npm run migrate:credentials -- <workspace-path>

# Explicit mappings (for custom env var names)
npm run migrate:credentials -- <workspace-path> --integration=ENV_VAR_NAME

# Example
npm run migrate:credentials -- ../agent --air=AIR_API_KEY --custom=MY_CUSTOM_TOKEN
```

## Future: Plugin migration

Each integration will become a source plugin that declares its env var dependencies in its manifest. The `envVars` field on `IntegrationConfig` is designed to map directly to the plugin's declared dependencies.
