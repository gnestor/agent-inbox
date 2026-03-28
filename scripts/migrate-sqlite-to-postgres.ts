// scripts/migrate-sqlite-to-postgres.ts
//
// One-time migration: reads all data from the SQLite database and inserts it
// into the PostgreSQL database. Run after setting up Postgres and before
// switching the app over.
//
// Usage:
//   DATABASE_URL=postgresql://... npx tsx scripts/migrate-sqlite-to-postgres.ts [sqlite-path]
//
// Default SQLite path: data/inbox.db (relative to packages/inbox)

import Database from "better-sqlite3"
import pg from "pg"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { readFileSync } from "fs"

const __dirname = dirname(fileURLToPath(import.meta.url))

const sqlitePath = process.argv[2] || resolve(__dirname, "../data/inbox.db")
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error("DATABASE_URL environment variable is required")
  process.exit(1)
}

console.log(`SQLite source: ${sqlitePath}`)
console.log(`Postgres target: ${databaseUrl.replace(/:[^@]*@/, ':***@')}`)

const sqlite = new Database(sqlitePath, { readonly: true })
const pool = new pg.Pool({ connectionString: databaseUrl })

// Run schema migration first
const schemaPath = resolve(__dirname, "../server/db/migrations/001_initial_schema.sql")
const schemaSql = readFileSync(schemaPath, "utf-8")
await pool.query(schemaSql)
console.log("Schema created/verified")

// Tables in foreign-key-safe order
const tables = [
  "users",
  "auth_sessions",
  "sessions",
  "session_messages",
  "user_preferences",
  "api_cache",
  "user_credentials",
  "workspace_credentials",
  "notion_options",
]

for (const table of tables) {
  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
  if (rows.length === 0) {
    console.log(`${table}: 0 rows (skipped)`)
    continue
  }

  const columns = Object.keys(rows[0])
  const placeholderRow = columns.map((_, i) => `$${i + 1}`).join(", ")
  const onConflict = getConflictClause(table, columns)
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholderRow}) ${onConflict}`

  let migrated = 0
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    for (const row of rows) {
      const values = columns.map((col) => {
        const val = row[col]
        // Convert metadata TEXT to JSONB-compatible value
        if (table === "sessions" && col === "metadata" && typeof val === "string") {
          try {
            JSON.parse(val) // validate it's valid JSON
            return val
          } catch {
            return null
          }
        }
        return val
      })
      await client.query(sql, values)
      migrated++
    }
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK")
    console.error(`${table}: FAILED after ${migrated} rows`, err)
    continue
  } finally {
    client.release()
  }

  console.log(`${table}: ${migrated} rows migrated`)
}

// Reset the session_messages SERIAL sequence
const maxId = await pool.query("SELECT COALESCE(MAX(id), 0) as max_id FROM session_messages")
if (maxId.rows[0].max_id > 0) {
  await pool.query(`SELECT setval('session_messages_id_seq', $1)`, [maxId.rows[0].max_id])
  console.log(`Reset session_messages sequence to ${maxId.rows[0].max_id}`)
}

sqlite.close()
await pool.end()
console.log("\nMigration complete!")

function getConflictClause(table: string, columns: string[]): string {
  // Use ON CONFLICT DO NOTHING to skip duplicates
  switch (table) {
    case "sessions":
      return "ON CONFLICT (id) DO NOTHING"
    case "session_messages":
      return "ON CONFLICT (session_id, sequence) DO NOTHING"
    case "users":
      return "ON CONFLICT (email) DO NOTHING"
    case "auth_sessions":
      return "ON CONFLICT (token) DO NOTHING"
    case "user_preferences":
      return "ON CONFLICT (user_email, key) DO NOTHING"
    case "api_cache":
      return "ON CONFLICT (key) DO NOTHING"
    case "user_credentials":
      return "ON CONFLICT (user_email, integration) DO NOTHING"
    case "workspace_credentials":
      return "ON CONFLICT (workspace, integration) DO NOTHING"
    case "notion_options":
      return "ON CONFLICT (property, value) DO NOTHING"
    default:
      return ""
  }
}
