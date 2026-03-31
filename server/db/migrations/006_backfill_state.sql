-- Track context backfill progress per plugin
CREATE TABLE IF NOT EXISTS backfill_state (
  plugin_id TEXT PRIMARY KEY,
  cursor TEXT,
  updated_at TEXT NOT NULL
);
