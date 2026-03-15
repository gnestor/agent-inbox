// server/scripts/migrate-env-to-vault.ts
//
// One-time migration: reads existing workspace .env credentials and stores them
// as workspace-scoped credentials in the vault.
//
// Usage: tsx server/scripts/migrate-env-to-vault.ts <workspace-path>
// Example: tsx server/scripts/migrate-env-to-vault.ts ~/Github/hammies/hammies-agent

import { config } from "dotenv"
import { resolve } from "path"
import { homedir } from "os"
import { initializeDatabase } from "../db/schema.js"
import { storeWorkspaceCredential } from "../lib/vault.js"

// Load inbox .env (for VAULT_SECRET)
config({ path: resolve(import.meta.dirname, "../../.env") })

const rawWorkspacePath = process.argv[2]
if (!rawWorkspacePath) {
  console.error("Usage: tsx server/scripts/migrate-env-to-vault.ts <workspace-path>")
  process.exit(1)
}

// Expand ~ to home directory
const workspacePath = rawWorkspacePath.startsWith("~")
  ? rawWorkspacePath.replace("~", homedir())
  : resolve(rawWorkspacePath)

// Load workspace .env
const workspaceEnv = config({ path: resolve(workspacePath, ".env") })
if (workspaceEnv.error) {
  console.error(`Failed to load .env from ${workspacePath}: ${workspaceEnv.error.message}`)
  process.exit(1)
}
const creds = workspaceEnv.parsed || {}

initializeDatabase()

// Map known env vars to integration name (all workspace-scoped)
const ENV_TO_INTEGRATION: Record<string, string> = {
  NOTION_API_TOKEN: "notion",
  SLACK_BOT_TOKEN: "slack",
  SHOPIFY_ACCESS_TOKEN: "shopify",
  GITHUB_TOKEN: "github",
  AIR_API_KEY: "air",
}

const workspaceName = workspacePath.split("/").pop() || workspacePath

let count = 0
for (const [envKey, value] of Object.entries(creds)) {
  const integration = ENV_TO_INTEGRATION[envKey]
  if (!integration || !value) continue

  storeWorkspaceCredential(workspaceName, integration, value)
  console.log(`Migrated ${envKey} → workspace_credentials[${workspaceName}, ${integration}]`)
  count++
}

console.log(`\nDone. Migrated ${count} credential${count === 1 ? "" : "s"}.`)
