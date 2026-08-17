import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { getPool as _getPool, query as _query, queryOne as _queryOne, queryRows as _queryRows, queryOptionalRow as _queryOptionalRow, queryRequiredRow as _queryRequiredRow, execute as _execute, withTransaction as _withTransaction } from "@hammies/db"
import type pg from "pg"
import type { ContractSchema } from "@hammies/contracts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const TRANSIENT_DATABASE_ERROR_CODES = new Set([
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "57P01",
  "57P02",
  "57P03",
])

function databaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined
  }
  return typeof error.code === "string" ? error.code : undefined
}

function retryDelayMs(attempt: number): number {
  return Math.min(250 * 2 ** Math.min(attempt - 1, 5), 5_000)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function runMigration(
  databasePool: pg.Pool,
  file: string,
  sql: string,
): Promise<void> {
  let attempt = 0
  while (true) {
    try {
      await databasePool.query(sql)
      return
    } catch (error) {
      const code = databaseErrorCode(error)
      if (code === undefined || !TRANSIENT_DATABASE_ERROR_CODES.has(code)) {
        throw error
      }
      attempt += 1
      const retryInMs = retryDelayMs(attempt)
      console.warn(
        `[database] ${file} failed with ${code}; retrying in ${retryInMs}ms`,
      )
      await delay(retryInMs)
    }
  }
}

function pool(): pg.Pool {
  const connectionString = process.env.INBOX_DATABASE_URL ?? process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      "INBOX_DATABASE_URL or DATABASE_URL must be set (e.g. postgresql://user:pass@host:5432/inbox)"
    )
  }
  return _getPool({ connectionString })
}

export function getPool(): pg.Pool {
  return pool()
}

// --- credential vault pool -------------------------------------------------
// The @hammies/auth credential vault (user_credentials / workspace_credentials)
// is single-homed in the studio DB (STUDIO_DATABASE_URL) — the canonical home
// per the credential-vault spec — so inbox, studio, and the data-pipeline broker
// all read/refresh ONE row and the per-database advisory lock actually serializes
// across processes. This is a DIFFERENT database from inbox's own tables
// (sessions, emails, …), which stay on DATABASE_URL. Falls back to DATABASE_URL
// only if STUDIO_DATABASE_URL is unset (pre-split behavior), which forks the QBO
// refresh-token chain — so STUDIO_DATABASE_URL must be set wherever the vault is used.
function vaultPool(): pg.Pool {
  const connectionString = process.env.STUDIO_DATABASE_URL ?? process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      "STUDIO_DATABASE_URL (or DATABASE_URL) must be set — the credential vault lives in the studio DB",
    )
  }
  return _getPool({ connectionString })
}

export function getVaultPool(): pg.Pool {
  return vaultPool()
}

export async function vaultQuery<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  return _query<T>(vaultPool(), sql, params)
}

export async function vaultQueryOne<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T | undefined> {
  return _queryOne<T>(vaultPool(), sql, params)
}

export async function vaultExecute(
  sql: string,
  params?: unknown[],
): Promise<{ rowCount: number }> {
  return _execute(vaultPool(), sql, params)
}

export async function query<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  return _query<T>(pool(), sql, params)
}

export async function queryOne<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T | undefined> {
  return _queryOne<T>(pool(), sql, params)
}

export async function queryOptionalRow<T>(
  schema: ContractSchema<T>,
  queryName: string,
  sql: string,
  params?: unknown[],
): Promise<T | undefined> {
  return _queryOptionalRow(pool(), schema, queryName, sql, params)
}

export async function queryRows<T>(
  schema: ContractSchema<T>,
  queryName: string,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  return _queryRows(pool(), schema, queryName, sql, params)
}

export async function queryRequiredRow<T>(
  schema: ContractSchema<T>,
  queryName: string,
  sql: string,
  params?: unknown[],
): Promise<T> {
  return _queryRequiredRow(pool(), schema, queryName, sql, params)
}

export async function execute(
  sql: string,
  params?: unknown[],
): Promise<{ rowCount: number }> {
  return _execute(pool(), sql, params)
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return _withTransaction(pool(), fn)
}

export async function initializeDatabase(): Promise<void> {
  const migrations = [
    "001_initial_schema.sql",
    "002_workspaces.sql",
    "003_remove_legacy_linked_columns.sql",
    "004_drop_api_cache.sql",
    "005_drop_session_messages.sql",
    "006_backfill_state.sql",
    "007_source_entities.sql",
    "008_body_extraction_log.sql",
    "009_webhook_replay_claims.sql",
  ]
  const p = pool()
  for (const file of migrations) {
    const sql = readFileSync(resolve(__dirname, "migrations", file), "utf-8")
    await runMigration(p, file, sql)
  }
  console.log("Database initialized (PostgreSQL)")
}

export async function closePool(): Promise<void> {
  await pool().end()
}
