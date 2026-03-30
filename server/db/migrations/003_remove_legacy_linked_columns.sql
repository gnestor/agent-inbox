-- Remove legacy plugin-specific linked columns from sessions table.
-- All data has been migrated to linked_source_type/linked_source_id.

-- Backfill any remaining rows that still use legacy columns
UPDATE sessions SET
  linked_source_type = 'gmail',
  linked_source_id = linked_email_thread_id
WHERE linked_email_thread_id IS NOT NULL AND linked_source_id IS NULL;

UPDATE sessions SET
  linked_source_type = 'notion-tasks',
  linked_source_id = linked_task_id
WHERE linked_task_id IS NOT NULL AND linked_source_id IS NULL;

-- Drop legacy columns
ALTER TABLE sessions DROP COLUMN IF EXISTS linked_email_id;
ALTER TABLE sessions DROP COLUMN IF EXISTS linked_email_thread_id;
ALTER TABLE sessions DROP COLUMN IF EXISTS linked_task_id;

-- Drop Notion options table (now fetched directly from Notion API by workspace plugin)
DROP TABLE IF EXISTS notion_options;
