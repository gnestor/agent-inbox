-- Seed entities extracted from raw source stubs.
-- Used to group sources by (entity_type, entity_value) for proximity-based
-- curation: one curation session processes all sources that mention a single
-- entity, rather than a chronological mix.
CREATE TABLE IF NOT EXISTS source_entities (
  source_path TEXT NOT NULL,          -- e.g. "context/gmail/abc123.md"
  plugin_id TEXT NOT NULL,            -- e.g. "gmail"
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,          -- "person" | "company" | "domain" | "folder" | "channel" | ...
  entity_value TEXT NOT NULL,         -- canonical form
  source_added_at TEXT NOT NULL,
  processed_for_entity INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_path, entity_type, entity_value)
);

-- Look up all sources for a given entity (the main read path)
CREATE INDEX IF NOT EXISTS idx_source_entities_entity
  ON source_entities (workspace_id, entity_type, entity_value, processed_for_entity);

-- Look up the top entities by unprocessed-source count (used by curate-entity/next)
CREATE INDEX IF NOT EXISTS idx_source_entities_unprocessed
  ON source_entities (workspace_id, processed_for_entity)
  WHERE processed_for_entity = 0;
