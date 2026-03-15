// server/scripts/migrate-env-to-vault.ts
//
// Migrate workspace .env credentials into the encrypted vault.
//
// Usage:
//   tsx server/scripts/migrate-env-to-vault.ts <workspace-path>
//   tsx server/scripts/migrate-env-to-vault.ts <workspace-path> --air=AIR_API_KEY --custom=MY_TOKEN
//
// Without explicit mappings, auto-detects credentials from the integration
// registry (envVars.credential for each integration).
//
// With explicit mappings (--integration=ENV_VAR), only those are migrated.
// This lets you handle custom env var names without changing the registry.

import { config } from "dotenv"
import { resolve } from "path"
import { homedir } from "os"
import { initializeDatabase } from "../db/schema.js"
import { storeWorkspaceCredential } from "../lib/vault.js"
import { buildEnvToIntegrationMap } from "../lib/integrations.js"

// Load inbox .env (for VAULT_SECRET)
config({ path: resolve(import.meta.dirname, "../../.env") })

// Parse args: first positional arg is workspace path, rest are --integration=ENV_VAR
const args = process.argv.slice(2)
const rawWorkspacePath = args.find((a) => !a.startsWith("--"))
const explicitMappings = new Map<string, string>() // ENV_VAR → integration

for (const arg of args) {
  if (!arg.startsWith("--")) continue
  const [key, value] = arg.slice(2).split("=")
  if (key && value) {
    // --air=AIR_API_KEY → integration "air" uses env var "AIR_API_KEY"
    explicitMappings.set(value, key)
  }
}

if (!rawWorkspacePath) {
  console.error(`Usage: tsx server/scripts/migrate-env-to-vault.ts <workspace-path> [--integration=ENV_VAR ...]

Examples:
  tsx server/scripts/migrate-env-to-vault.ts ~/Github/hammies/packages/agent
  tsx server/scripts/migrate-env-to-vault.ts ./packages/agent --air=AIR_API_KEY --custom=MY_TOKEN

Without --flags, auto-detects credentials from the integration registry.
With --flags, only the specified mappings are migrated.`)
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
const envVars = workspaceEnv.parsed || {}

initializeDatabase()

// Build the mapping: ENV_VAR → integration name
const envToIntegration: Map<string, string> = explicitMappings.size > 0
  ? explicitMappings
  : new Map(Object.entries(buildEnvToIntegrationMap()))

// Derive workspace name from git remote (repo name), fallback to dir basename
import { execFileSync } from "child_process"
let workspaceName: string
try {
  const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], { cwd: workspacePath, encoding: "utf-8" }).trim()
  workspaceName = remoteUrl.replace(/\.git$/, "").split("/").pop() || workspacePath.split("/").pop() || workspacePath
} catch {
  workspaceName = workspacePath.split("/").pop() || workspacePath
}

let count = 0
for (const [envKey, value] of Object.entries(envVars)) {
  const integration = envToIntegration.get(envKey)
  if (!integration || !value) continue

  storeWorkspaceCredential(workspaceName, integration, value)
  console.log(`Migrated ${envKey} → workspace_credentials[${workspaceName}, ${integration}]`)
  count++
}

if (count === 0) {
  console.log("\nNo matching credentials found in .env")
  if (explicitMappings.size === 0) {
    console.log("Tip: use --integration=ENV_VAR to specify custom mappings")
  }
} else {
  console.log(`\nDone. Migrated ${count} credential${count === 1 ? "" : "s"}.`)
}
