-- Context backfill progress tracking.
-- Tracks per-plugin indexing state so incremental backfills can resume.

CREATE TABLE IF NOT EXISTS backfill_state (
  plugin_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  last_run_at TEXT NOT NULL,
  total_indexed INTEGER NOT NULL DEFAULT 0,
  last_cursor TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, workspace_id)
);
