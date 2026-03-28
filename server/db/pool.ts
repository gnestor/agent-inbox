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
        "DATABASE_URL must be set (e.g. postgresql://inbox:pass@grants-mac-mini.tail21f7c3.ts.net:5432/inbox)"
      )
    }
    pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
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
  const migrationSql = readFileSync(
    resolve(__dirname, "migrations/001_initial_schema.sql"),
    "utf-8",
  )
  await getPool().query(migrationSql)

  // Column migrations (equivalent to SQLite PRAGMA table_info checks)
  const cols = await query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions'",
  )
  const colNames = cols.map((c) => c.column_name)

  if (!colNames.includes("linked_source_id")) {
    await execute("ALTER TABLE sessions ADD COLUMN linked_source_id TEXT")
  }
  if (!colNames.includes("linked_source_type")) {
    await execute("ALTER TABLE sessions ADD COLUMN linked_source_type TEXT")
  }

  // Migrate legacy linked columns to generic linked_source_type/id
  await execute(
    "UPDATE sessions SET linked_source_type = 'gmail', linked_source_id = linked_email_thread_id WHERE linked_email_thread_id IS NOT NULL AND linked_source_id IS NULL",
  )
  await execute(
    "UPDATE sessions SET linked_source_type = 'notion-tasks', linked_source_id = linked_task_id WHERE linked_task_id IS NOT NULL AND linked_source_id IS NULL",
  )

  console.log("Database initialized (PostgreSQL)")
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
