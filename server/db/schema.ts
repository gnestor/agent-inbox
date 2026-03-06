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
      message_count INTEGER DEFAULT 0,
      linked_email_id TEXT,
      linked_email_thread_id TEXT,
      linked_task_id TEXT,
      trigger_source TEXT DEFAULT 'manual',
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(session_id, sequence)
    );

    CREATE INDEX IF NOT EXISTS idx_session_messages_session
      ON session_messages(session_id, sequence);

    CREATE TABLE IF NOT EXISTS email_task_links (
      email_id TEXT NOT NULL,
      email_thread_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (email_id, task_id)
    );

    CREATE TABLE IF NOT EXISTS notion_options (
      property TEXT NOT NULL,
      value TEXT NOT NULL,
      color TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (property, value)
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_name TEXT NOT NULL,
      user_email TEXT NOT NULL,
      user_picture TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processed_emails (
      email_id TEXT PRIMARY KEY,
      thread_id TEXT,
      from_address TEXT,
      subject TEXT,
      processed_at TEXT NOT NULL,
      notion_task_id TEXT,
      session_id TEXT,
      rule_name TEXT,
      action TEXT
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_email TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_email, key)
    );

    CREATE TABLE IF NOT EXISTS api_cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_api_cache_expires
      ON api_cache(expires_at);
  `)

  console.log("Database initialized at", DB_PATH)
}
