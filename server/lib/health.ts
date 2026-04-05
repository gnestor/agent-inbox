/**
 * Health check runner — verifies that the key runtime dependencies are alive.
 */
import { getPool } from "../db/pool.js"
import { getPlugins } from "./plugin-loader.js"

export interface ComponentStatus {
  status: "ok" | "error"
  error?: string
}

export interface DatabaseStatus extends ComponentStatus {
  latencyMs?: number
}

export interface PluginStatus extends ComponentStatus {
  count: number
}

export interface HealthReport {
  database: DatabaseStatus
  vault: ComponentStatus
  plugins: PluginStatus
  workspaces: { count: number; paths: string[] }
}

/** VAULT_SECRET must be exactly 64 hex characters (32 bytes). */
function isValidVaultSecret(secret: string | undefined): boolean {
  if (!secret) return false
  return /^[0-9a-fA-F]{64}$/.test(secret)
}

async function checkDatabase(): Promise<DatabaseStatus> {
  const start = Date.now()
  try {
    const pool = getPool()
    await pool.query("SELECT 1")
    return { status: "ok", latencyMs: Date.now() - start }
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) }
  }
}

function checkVault(): ComponentStatus {
  if (!process.env.VAULT_SECRET) {
    return { status: "error", error: "VAULT_SECRET env var not set" }
  }
  if (!isValidVaultSecret(process.env.VAULT_SECRET)) {
    return { status: "error", error: "VAULT_SECRET must be 64 hex characters" }
  }
  return { status: "ok" }
}

function checkPlugins(): PluginStatus {
  try {
    const plugins = getPlugins()
    return { status: "ok", count: plugins.length }
  } catch (err) {
    return { status: "error", count: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function runHealthChecks(workspacePaths: string[]): Promise<HealthReport> {
  const [database, vault, plugins] = [
    await checkDatabase(),
    checkVault(),
    checkPlugins(),
  ]
  return {
    database,
    vault,
    plugins,
    workspaces: { count: workspacePaths.length, paths: workspacePaths },
  }
}

/** True if all critical components report ok (database + vault). */
export function isHealthy(report: HealthReport): boolean {
  return report.database.status === "ok" && report.vault.status === "ok"
}
