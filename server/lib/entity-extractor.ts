/**
 * Seed entity extraction — runs after raw backfill writes each stub.
 * Extracted entities are stored in the source_entities table and used by
 * the entity-curation flow to group related sources for proximity-based
 * processing.
 *
 * Delegates to `plugin.extractEntities(item)` when provided. Falls back to
 * a generic stub-frontmatter scan so the system always has something to
 * group by, even for plugins that don't implement extraction yet.
 */

import { readFile } from "fs/promises"
import { join } from "path"
import { createLogger } from "./logger.js"
import { execute, query as dbQuery } from "../db/pool.js"
import type { Plugin, PluginItem, Entity } from "../../src/types/plugin.js"

const log = createLogger("entity-extractor")

// Email pattern, conservative — matches most real addresses without false positives
const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g

// Noise filtering is plugin-specific and lives in each plugin's
// itemToContext / extractEntities methods. The fallback scanner and the bulk
// /extract-entities endpoint are naive by design — they trust that stubs
// reaching disk were already filtered by the plugin that wrote them.

/**
 * Turn an entity value into a canonical form for matching + slugging.
 * - Emails: lowercased
 * - Names/folders: lowercased, spaces → hyphens, non-alphanumeric stripped
 */
export function canonicalize(type: string, value: string): string {
  if (type === "person" || type === "domain") {
    return value.trim().toLowerCase()
  }
  if (type === "company" || type === "folder" || type === "channel" || type === "database" || type === "skill") {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  }
  return value.trim()
}

/**
 * Fallback: scan stub markdown for obvious entities in frontmatter + body.
 * Used when a plugin doesn't implement extractEntities.
 */
async function fallbackFromStub(stubPath: string): Promise<Entity[]> {
  let content: string
  try {
    content = await readFile(stubPath, "utf8")
  } catch {
    return []
  }

  const entities: Entity[] = []

  // Extract emails (frontmatter + body). The plugin is responsible for filtering
  // noise before a stub reaches disk — see gmail plugin's itemToContext.
  const emails = new Set<string>()
  for (const match of content.matchAll(EMAIL_RE)) {
    emails.add(match[0].toLowerCase())
  }
  for (const email of emails) {
    entities.push({ type: "person", value: email })
    const domain = email.split("@")[1]
    if (domain) entities.push({ type: "domain", value: domain })
  }

  // Extract folder-path from frontmatter (Drive stubs)
  const folderPathMatch = content.match(/^folder-path:\s*\[([^\]]*)\]/m)
  if (folderPathMatch) {
    const parts = folderPathMatch[1]!.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    for (const part of parts) {
      if (part) entities.push({ type: "folder", value: part })
    }
  }

  return entities
}

/**
 * Extract entities for one item and store them in source_entities.
 */
export async function extractEntitiesForItem(
  plugin: Plugin,
  item: PluginItem,
  workspacePath: string,
  workspaceId: string,
): Promise<number> {
  const stubRel = plugin.backfillDir
    ? `${plugin.backfillDir}/${item.id}.md`
    : `context/${plugin.id}/${item.id}.md`

  const rawEntities = plugin.extractEntities
    ? plugin.extractEntities(item)
    : await fallbackFromStub(join(workspacePath, stubRel))

  if (rawEntities.length === 0) return 0

  // Canonicalize and dedupe
  const seen = new Set<string>()
  const canonical: Entity[] = []
  for (const e of rawEntities) {
    const value = canonicalize(e.type, e.value)
    if (!value) continue
    const key = `${e.type}|${value}`
    if (seen.has(key)) continue
    seen.add(key)
    canonical.push({ type: e.type, value })
  }

  const now = new Date().toISOString()
  for (const e of canonical) {
    await execute(
      `INSERT INTO source_entities (source_path, plugin_id, workspace_id, entity_type, entity_value, source_added_at, processed_for_entity)
       VALUES ($1, $2, $3, $4, $5, $6, 0)
       ON CONFLICT (source_path, entity_type, entity_value) DO NOTHING`,
      [stubRel, plugin.id, workspaceId, e.type, e.value, now],
    )
  }

  return canonical.length
}

/**
 * Full-sweep extraction over all existing stubs for a plugin.
 * Used for initial backfill of the entity index.
 */
export async function extractAllForPlugin(
  plugin: Plugin,
  items: PluginItem[],
  workspacePath: string,
  workspaceId: string,
): Promise<{ items: number; entities: number }> {
  let totalEntities = 0
  for (const item of items) {
    totalEntities += await extractEntitiesForItem(plugin, item, workspacePath, workspaceId)
  }
  log.info("Extracted entities for plugin", {
    plugin: plugin.id,
    items: items.length,
    entities: totalEntities,
  })
  return { items: items.length, entities: totalEntities }
}

/**
 * Return the top entities with unprocessed sources, ordered by count desc.
 * Used by the curate-entity/next scheduler to pick what to work on.
 */
export async function topUnprocessedEntities(
  workspaceId: string,
  limit = 10,
): Promise<{ entity_type: string; entity_value: string; source_count: number }[]> {
  return dbQuery<{ entity_type: string; entity_value: string; source_count: number }>(
    `SELECT entity_type, entity_value, COUNT(*)::int AS source_count
     FROM source_entities
     WHERE workspace_id = $1 AND processed_for_entity = 0
     GROUP BY entity_type, entity_value
     ORDER BY source_count DESC
     LIMIT $2`,
    [workspaceId, limit],
  )
}

/**
 * Unprocessed source paths for a given entity, capped to prevent a single
 * session from trying to process thousands of sources. Remaining sources
 * advance through subsequent calls as earlier ones are marked processed.
 */
export async function unprocessedSourcesForEntity(
  workspaceId: string,
  entityType: string,
  entityValue: string,
  limit = 100,
): Promise<string[]> {
  const rows = await dbQuery<{ source_path: string }>(
    `SELECT source_path FROM source_entities
     WHERE workspace_id = $1 AND entity_type = $2 AND entity_value = $3 AND processed_for_entity = 0
     ORDER BY source_added_at ASC
     LIMIT $4`,
    [workspaceId, entityType, entityValue, limit],
  )
  return rows.map((r) => r.source_path)
}

/**
 * Mark (source, entity) pairs as processed.
 */
export async function markProcessed(
  workspaceId: string,
  entityType: string,
  entityValue: string,
  sourcePaths: string[],
): Promise<void> {
  if (sourcePaths.length === 0) return
  await execute(
    `UPDATE source_entities
     SET processed_for_entity = 1
     WHERE workspace_id = $1 AND entity_type = $2 AND entity_value = $3 AND source_path = ANY($4::text[])`,
    [workspaceId, entityType, entityValue, sourcePaths],
  )
}

/**
 * Insert newly-discovered entities (from an agent's <new-entities> block)
 * against the source files that surfaced them.
 */
export async function insertDiscoveredEntities(
  workspaceId: string,
  pluginId: string,
  sourcePaths: string[],
  discovered: Entity[],
): Promise<number> {
  if (discovered.length === 0 || sourcePaths.length === 0) return 0
  const now = new Date().toISOString()
  let inserted = 0
  for (const source of sourcePaths) {
    for (const e of discovered) {
      const value = canonicalize(e.type, e.value)
      if (!value) continue
      const result = await execute(
        `INSERT INTO source_entities (source_path, plugin_id, workspace_id, entity_type, entity_value, source_added_at, processed_for_entity)
         VALUES ($1, $2, $3, $4, $5, $6, 0)
         ON CONFLICT (source_path, entity_type, entity_value) DO NOTHING`,
        [source, pluginId, workspaceId, e.type, value, now],
      )
      inserted += result.rowCount ?? 0
    }
  }
  return inserted
}
