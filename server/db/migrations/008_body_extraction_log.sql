-- Tracks which source files have had body-text entity extraction run,
-- so the bulk extract-bodies pass can resume without re-processing.
CREATE TABLE IF NOT EXISTS body_extraction_log (
  source_path   TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  plugin_id     TEXT NOT NULL,
  extracted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entity_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_path, workspace_id)
);
