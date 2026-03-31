import pg from "pg"
import { readFileSync } from "fs"
import { resolve } from "path"
import { fileURLToPath } from "url"
import { dirname } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL must be set (e.g. postgresql://user:pass@host:5432/inbox)"
      )
    }
    pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  }
  return pool
}

export async function query<T extends pg.QueryResultRow = any>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params)
  return result.rows
}

export async function queryOne<T extends pg.QueryResultRow = any>(
  sql: string,
  params?: unknown[],
): Promise<T | undefined> {
  const rows = await query<T>(sql, params)
  return rows[0]
}

export async function execute(
  sql: string,
  params?: unknown[],
): Promise<{ rowCount: number }> {
  const result = await getPool().query(sql, params)
  return { rowCount: result.rowCount ?? 0 }
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query("BEGIN")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}

export async function initializeDatabase(): Promise<void> {
  const migrations = [
    "001_initial_schema.sql",
    "002_workspaces.sql",
    "003_remove_legacy_linked_columns.sql",
    "004_drop_api_cache.sql",
    "005_drop_session_messages.sql",
    "006_backfill_state.sql",
  ]
  for (const file of migrations) {
    const sql = readFileSync(resolve(__dirname, "migrations", file), "utf-8")
    await getPool().query(sql)
  }

  console.log("Database initialized (PostgreSQL)")
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
