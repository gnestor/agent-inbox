import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { getPool as _getPool, query as _query, queryOne as _queryOne, execute as _execute, withTransaction as _withTransaction } from "@hammies/db"
import type pg from "pg"

const __dirname = dirname(fileURLToPath(import.meta.url))

function pool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL must be set (e.g. postgresql://user:pass@host:5432/inbox)"
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
  ]
  const p = pool()
  for (const file of migrations) {
    const sql = readFileSync(resolve(__dirname, "migrations", file), "utf-8")
    await p.query(sql)
  }
  console.log("Database initialized (PostgreSQL)")
}

export async function closePool(): Promise<void> {
  await pool().end()
}
