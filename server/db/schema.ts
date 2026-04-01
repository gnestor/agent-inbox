import Database from "better-sqlite3"
import { resolve } from "path"
import { fileURLToPath } from "url"
import { dirname } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = resolve(__dirname, "../../data/inbox.db")

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma("journal_mode = WAL")
    db.pragma("foreign_keys = ON")
  }
  return db
}

export function initializeDatabase() {
  const database = getDb()

  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'running',
      prompt TEXT NOT NULL,
      summary TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      linked_source_type TEXT,
      linked_source_id TEXT,
      trigger_source TEXT DEFAULT 'manual',
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      picture TEXT,
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_name TEXT NOT NULL,
      user_email TEXT NOT NULL,
      user_picture TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_email TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_email, key)
    );

    CREATE TABLE IF NOT EXISTS user_credentials (
      user_email TEXT NOT NULL REFERENCES users(email),
      integration TEXT NOT NULL,
      encrypted_token TEXT NOT NULL,
      refresh_token TEXT,
      scopes TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_email, integration)
    );

    CREATE TABLE IF NOT EXISTS workspace_credentials (
      workspace TEXT NOT NULL,
      integration TEXT NOT NULL,
      encrypted_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace, integration)
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      user_email TEXT NOT NULL REFERENCES users(email),
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_email)
    );
  `)

  // Migrations for existing tables
  const sessionCols = (database.pragma("table_info(sessions)") as { name: string }[]).map(c => c.name)
  console.log("Database initialized at", DB_PATH)
}
