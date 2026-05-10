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
