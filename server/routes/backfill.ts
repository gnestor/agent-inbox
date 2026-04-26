import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { mkdir, writeFile } from "fs/promises"
import { join } from "path"
import { queryOne, execute } from "../db/pool.js"
import { getPlugins, getPlugin } from "../lib/plugin-loader.js"
import { buildPluginContext, getWorkspaceId, getWorkspacePath } from "../lib/plugin-context.js"
import { extractEntitiesForItem } from "../lib/entity-extractor.js"
import type { Plugin, PluginContext } from "../../src/types/plugin.js"

/**
 * Render and write a single item's stub: enrich → render markdown → write file →
 * extract entities. Used by both the live backfill loop and the re-render endpoint
 * so they can't drift out of sync. Returns true when a stub was written.
 */
async function renderItem(
  plugin: Plugin,
  item: import("../../src/types/plugin.js").PluginItem,
  contextDir: string,
  workspacePath: string,
  wsId: string,
  ctx?: PluginContext,
): Promise<boolean> {
  let enriched = item
  if (plugin.enrichForContext) {
    try {
      enriched = await plugin.enrichForContext(item, ctx)
    } catch (err) {
      console.warn(`[backfill] enrichForContext failed for ${plugin.id}/${item.id}:`, (err as Error).message)
    }
  }
  const markdown = plugin.itemToContext!(enriched)
  if (!markdown) return false
  await writeFile(join(contextDir, `${item.id}.md`), markdown)
  try {
    await extractEntitiesForItem(plugin, enriched, workspacePath, wsId)
  } catch (err) {
    console.warn(`[backfill] entity extraction failed for ${plugin.id}/${item.id}:`, (err as Error).message)
  }
  return true
}

export async function runBackfill(
  plugin: Plugin,
  workspacePath: string,
  ctx?: PluginContext,
  workspaceId?: string,
): Promise<{ processed: number; total: number; nextCursor: string | null }> {
  const wsId = workspaceId || "agent"
  const row = await queryOne<{ last_cursor: string | null; last_run_at: string | null }>(
    "SELECT last_cursor, last_run_at FROM backfill_state WHERE plugin_id = $1 AND workspace_id = $2",
    [plugin.id, wsId],
  )

  // When last_run_at is a real timestamp (not epoch placeholder from initial pagination),
  // pass it as `since` so plugins fetch only modified records.
  const EPOCH = "1970-01-01T00:00:00Z"
  const hasCompletedRun = row?.last_run_at && row.last_run_at !== EPOCH
  const filters: Record<string, string> = {}
  if (hasCompletedRun) filters.since = row!.last_run_at!

  const cursor = hasCompletedRun ? undefined : (row?.last_cursor ?? undefined)
  const result = await plugin.query!(filters, cursor, ctx)

  const contextDir = join(workspacePath, plugin.backfillDir ?? `context/${plugin.id}`)
  await mkdir(contextDir, { recursive: true })

  const writes = result.items.map((item) => renderItem(plugin, item, contextDir, workspacePath, wsId, ctx))
  const results = await Promise.all(writes)
  const processed = results.filter(Boolean).length

  const nextCursor = result.nextCursor ?? null
  const now = new Date().toISOString()
  // Only set last_run_at when pagination is complete (no nextCursor).
  // This prevents switching to `since` mode mid-pagination on the initial full pass.
  // Use epoch as placeholder during pagination (DB column is NOT NULL).
  const runAt = nextCursor ? (row?.last_run_at ?? "1970-01-01T00:00:00Z") : now
  await execute(
    `INSERT INTO backfill_state (plugin_id, workspace_id, last_cursor, last_run_at, total_indexed, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (plugin_id, workspace_id) DO UPDATE
       SET last_cursor = EXCLUDED.last_cursor,
           last_run_at = EXCLUDED.last_run_at,
           total_indexed = backfill_state.total_indexed + $5,
           updated_at = EXCLUDED.updated_at`,
    [plugin.id, wsId, nextCursor, runAt, processed, now],
  )

  return { processed, total: result.items.length, nextCursor }
}

export const backfillRoutes = new Hono()

/** POST /api/backfill/curate — launch a curation session for a single source.
 *  Required query param ?source={pluginId} (e.g. gmail, gorgias, sessions). */
backfillRoutes.post("/curate", async (c) => {
  const workspacePath = getWorkspacePath(c)
  if (!workspacePath) throw new HTTPException(400, { message: "No active workspace" })

  const sourceFilter = c.req.query("source")
  if (!sourceFilter) {
    throw new HTTPException(400, { message: "?source={pluginId} is required" })
  }
  const { runCuratedUpdate } = await import("../lib/context-backfill-scheduler.js")
  const result = await runCuratedUpdate(workspacePath, getWorkspaceId(c), sourceFilter)
  return c.json(result)
})

/**
 * POST /api/backfill/curate-entity?type=X&value=Y — curate a single entity.
 * POST /api/backfill/curate-entity/next — curate the entity with the most unprocessed sources.
 */
backfillRoutes.post("/curate-entity/next", async (c) => {
  const workspacePath = getWorkspacePath(c)
  if (!workspacePath) throw new HTTPException(400, { message: "No active workspace" })
  const { curateNextEntity } = await import("../lib/entity-curator.js")
  const result = await curateNextEntity(workspacePath, getWorkspaceId(c))
  return c.json(result)
})

backfillRoutes.post("/curate-entity", async (c) => {
  const workspacePath = getWorkspacePath(c)
  if (!workspacePath) throw new HTTPException(400, { message: "No active workspace" })
  const type = c.req.query("type")
  const value = c.req.query("value")
  if (!type || !value) {
    throw new HTTPException(400, { message: "?type=X&value=Y are required" })
  }
  const { curateEntity } = await import("../lib/entity-curator.js")
  const result = await curateEntity(workspacePath, type, value, getWorkspaceId(c))
  return c.json(result)
})

/**
 * POST /api/backfill/record-discovered — operator tool: record <new-entities>
 * from a completed curation session's output. Body: { pluginId, sourcePaths[], block }
 */
backfillRoutes.post("/record-discovered", async (c) => {
  const wsId = getWorkspaceId(c) || "agent"
  const { pluginId, sourcePaths, block } = await c.req.json<{ pluginId: string; sourcePaths: string[]; block: string }>()
  if (!pluginId || !Array.isArray(sourcePaths) || typeof block !== "string") {
    throw new HTTPException(400, { message: "body must be { pluginId, sourcePaths[], block }" })
  }
  const { recordDiscoveredEntities } = await import("../lib/entity-curator.js")
  const inserted = await recordDiscoveredEntities(wsId, pluginId, sourcePaths, block)
  return c.json({ inserted })
})

/**
 * POST /api/backfill/extract-entities — bulk-extract seed entities from EXISTING stubs.
 * Optional ?source={pluginId} to scope to a single source. Uses the generic
 * frontmatter fallback (can't call plugin.extractEntities without the original
 * PluginItem). New stubs emit entities via the runBackfill path directly.
 */
backfillRoutes.post("/extract-entities", async (c) => {
  const workspacePath = getWorkspacePath(c)
  if (!workspacePath) throw new HTTPException(400, { message: "No active workspace" })

  const wsId = getWorkspaceId(c) || "agent"
  const sourceFilter = c.req.query("source")
  const plugins = getPlugins(wsId).filter((p) => p.itemToContext)
  const targets = sourceFilter ? plugins.filter((p) => p.id === sourceFilter) : plugins

  const { readdir, readFile } = await import("fs/promises")
  const { canonicalize } = await import("../lib/entity-extractor.js")

  const results: Record<string, { scanned: number; entities: number }> = {}
  const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g
  const now = new Date().toISOString()

  for (const plugin of targets) {
    const relDir = plugin.backfillDir ?? `context/${plugin.id}`
    const absDir = join(workspacePath, relDir)
    let files: string[]
    try {
      files = await readdir(absDir)
    } catch {
      results[plugin.id] = { scanned: 0, entities: 0 }
      continue
    }
    let scanned = 0
    let entityCount = 0
    for (const file of files) {
      if (!file.endsWith(".md")) continue
      scanned++
      const sourcePath = `${relDir}/${file}`
      // Skip if we already have entities for this source
      const existing = await queryOne<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM source_entities WHERE source_path = $1 AND workspace_id = $2`,
        [sourcePath, wsId],
      )
      if ((existing?.c ?? 0) > 0) continue

      let content: string
      try {
        content = await readFile(join(absDir, file), "utf8")
      } catch {
        continue
      }

      const emails = new Set<string>()
      for (const m of content.matchAll(EMAIL_RE)) emails.add(m[0].toLowerCase())

      const folderPath: string[] = []
      const fp = content.match(/^folder-path:\s*\[([^\]]*)\]/m)
      if (fp) {
        for (const part of fp[1]!.split(",")) {
          const v = part.trim().replace(/^['"]|['"]$/g, "")
          if (v) folderPath.push(v)
        }
      }

      const seen = new Set<string>()
      const rows: { type: string; value: string }[] = []
      for (const email of emails) {
        const v = canonicalize("person", email)
        if (v && !seen.has(`person|${v}`)) { seen.add(`person|${v}`); rows.push({ type: "person", value: v }) }
        const domain = email.split("@")[1]
        if (domain) {
          const dv = canonicalize("domain", domain)
          if (dv && !seen.has(`domain|${dv}`)) { seen.add(`domain|${dv}`); rows.push({ type: "domain", value: dv }) }
        }
      }
      for (const f of folderPath) {
        const v = canonicalize("folder", f)
        if (v && !seen.has(`folder|${v}`)) { seen.add(`folder|${v}`); rows.push({ type: "folder", value: v }) }
      }

      for (const r of rows) {
        await execute(
          `INSERT INTO source_entities (source_path, plugin_id, workspace_id, entity_type, entity_value, source_added_at, processed_for_entity)
           VALUES ($1, $2, $3, $4, $5, $6, 0)
           ON CONFLICT (source_path, entity_type, entity_value) DO NOTHING`,
          [sourcePath, plugin.id, wsId, r.type, r.value, now],
        )
        entityCount++
      }
    }
    results[plugin.id] = { scanned, entities: entityCount }
  }

  return c.json({ results })
})

/**
 * POST /api/backfill/extract-bodies?source={pluginId}&limit=N
 *
 * Bulk body-text entity extraction via a local LLM (Ollama). For each stub
 * that hasn't been processed yet (tracked in body_extraction_log), sends the
 * body to Qwen 3.5 and inserts discovered entities into source_entities.
 * Skips sources that already appear in body_extraction_log. One source per
 * call is processed serially (Ollama serializes anyway).
 *
 * Required: ?source={pluginId}
 * Optional: ?limit=N (default 100) — number of stubs to process this call
 */
backfillRoutes.post("/extract-bodies", async (c) => {
  const workspacePath = getWorkspacePath(c)
  if (!workspacePath) throw new HTTPException(400, { message: "No active workspace" })

  const wsId = getWorkspaceId(c) || "agent"
  const sourceFilter = c.req.query("source")
  if (!sourceFilter) throw new HTTPException(400, { message: "?source={pluginId} is required" })

  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "100", 10), 1), 500)
  const modelOverride = c.req.query("model") || undefined

  const plugin = getPlugins(wsId).find((p) => p.id === sourceFilter)
  if (!plugin || !plugin.itemToContext) {
    throw new HTTPException(400, { message: `unknown or unsupported source '${sourceFilter}'` })
  }

  const { readdir, readFile } = await import("fs/promises")
  const { extractBodyEntities } = await import("../lib/body-extractor.js")

  const relDir = plugin.backfillDir ?? `context/${plugin.id}`
  const absDir = join(workspacePath, relDir)

  let files: string[]
  try {
    files = await readdir(absDir)
  } catch {
    return c.json({ scanned: 0, extracted: 0, entities: 0, error: `no directory for ${sourceFilter}` })
  }

  // Already-done source_paths to skip.
  const done = new Set<string>()
  const doneRows = await (await import("../db/pool.js")).query<{ source_path: string }>(
    `SELECT source_path FROM body_extraction_log WHERE workspace_id = $1 AND plugin_id = $2`,
    [wsId, plugin.id],
  )
  for (const r of doneRows) done.add(r.source_path)

  // Build the work queue up-front, capped at `limit`, skipping sources
  // already logged.
  const queue: string[] = []
  for (const file of files) {
    if (!file.endsWith(".md")) continue
    const sourcePath = `${relDir}/${file}`
    if (done.has(sourcePath)) continue
    if (queue.length >= limit) break
    queue.push(file)
  }

  const concurrency = Math.max(
    1,
    Math.min(queue.length, parseInt(process.env.OLLAMA_NUM_PARALLEL || "2", 10)),
  )

  let scanned = queue.length
  let extracted = 0
  let totalEntities = 0
  const now = new Date().toISOString()

  async function worker() {
    while (true) {
      const file = queue.shift()
      if (!file) return
      const sourcePath = `${relDir}/${file}`

      let content: string
      try { content = await readFile(join(absDir, file), "utf8") }
      catch { continue }

      const entities = await extractBodyEntities(content, modelOverride)

      for (const e of entities) {
        await execute(
          `INSERT INTO source_entities (source_path, plugin_id, workspace_id, entity_type, entity_value, source_added_at, processed_for_entity)
           VALUES ($1, $2, $3, $4, $5, $6, 0)
           ON CONFLICT (source_path, entity_type, entity_value) DO NOTHING`,
          [sourcePath, plugin.id, wsId, e.type, e.value, now],
        )
        totalEntities++
      }

      await execute(
        `INSERT INTO body_extraction_log (source_path, workspace_id, plugin_id, extracted_at, entity_count)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_path, workspace_id) DO UPDATE
           SET extracted_at = EXCLUDED.extracted_at, entity_count = EXCLUDED.entity_count`,
        [sourcePath, wsId, plugin.id, now, entities.length],
      )
      extracted++
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))

  return c.json({
    source: sourceFilter,
    scanned,
    extracted,
    entities: totalEntities,
    concurrency,
    remaining: Math.max(0, files.length - done.size - extracted),
  })
})

/** POST /api/backfill/:pluginId — run context backfill for a single plugin */
backfillRoutes.post("/:pluginId", async (c) => {
  const { pluginId } = c.req.param()
  const workspacePath = getWorkspacePath(c)
  if (!workspacePath) throw new HTTPException(400, { message: "No active workspace" })

  const plugin = getPlugin(pluginId, getWorkspaceId(c))
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${pluginId}" not found` })
  if (!plugin.query || !plugin.itemToContext) {
    throw new HTTPException(400, { message: `Plugin "${pluginId}" does not support context backfill` })
  }

  const ctx = await buildPluginContext(c)
  const result = await runBackfill(plugin, workspacePath, ctx, getWorkspaceId(c))
  return c.json({ pluginId, ...result })
})

/**
 * POST /api/backfill/:pluginId/re-render — re-render existing stubs for a plugin.
 *
 * Walks files in the plugin's backfill dir, reconstructs each item via
 * `plugin.getItem(id)`, runs `enrichForContext` + `itemToContext`, and rewrites
 * the stub in place. Useful when a plugin's rendering or enrichment logic changes
 * and we want existing stubs to reflect the new shape without resetting
 * backfill_state.
 *
 * ?limit=N (default 100), ?skip=N (default 0) for pagination.
 */
backfillRoutes.post("/:pluginId/re-render", async (c) => {
  const { pluginId } = c.req.param()
  const limit = parseInt(c.req.query("limit") || "100", 10)
  const skip = parseInt(c.req.query("skip") || "0", 10)
  const workspacePath = getWorkspacePath(c)
  if (!workspacePath) throw new HTTPException(400, { message: "No active workspace" })

  const plugin = getPlugin(pluginId, getWorkspaceId(c))
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${pluginId}" not found` })
  if (!plugin.itemToContext || !plugin.getItem) {
    throw new HTTPException(400, {
      message: `Plugin "${pluginId}" needs both itemToContext and getItem to re-render`,
    })
  }

  const { readdir } = await import("fs/promises")
  const dir = join(workspacePath, plugin.backfillDir ?? `context/${plugin.id}`)
  let allFiles: string[]
  try {
    allFiles = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort()
  } catch {
    return c.json({ pluginId, processed: 0, total: 0, error: "directory not found" })
  }
  const total = allFiles.length
  const files = allFiles.slice(skip, skip + limit)

  const ctx = await buildPluginContext(c)
  const wsId = getWorkspaceId(c) || "agent"
  const counters = { processed: 0, skipped: 0, failed: 0 }

  const writes = files.map(async (file) => {
    const id = file.replace(/\.md$/, "")
    try {
      const item = await plugin.getItem!(id, ctx)
      if (!item) { counters.skipped++; return }
      const wrote = await renderItem(plugin, item, dir, workspacePath, wsId, ctx)
      if (wrote) counters.processed++
      else counters.skipped++
    } catch (err) {
      counters.failed++
      console.warn(`[re-render] ${pluginId}/${id}:`, (err as Error).message)
    }
  })
  await Promise.all(writes)

  return c.json({ pluginId, ...counters, batchSize: files.length, total, nextSkip: skip + files.length })
})

/** POST /api/backfill — run context backfill for all plugins with itemToContext */
backfillRoutes.post("/", async (c) => {
  const workspacePath = getWorkspacePath(c)
  if (!workspacePath) throw new HTTPException(400, { message: "No active workspace" })

  const plugins = getPlugins(getWorkspaceId(c)).filter((p) => p.query && p.itemToContext)
  const ctx = await buildPluginContext(c)
  const results: Record<string, { processed: number; total: number; nextCursor: string | null } | { error: string }> = {}

  await Promise.allSettled(plugins.map(async (plugin) => {
    try {
      results[plugin.id] = await runBackfill(plugin, workspacePath, ctx, getWorkspaceId(c))
    } catch (err) {
      results[plugin.id] = { error: (err as Error).message }
    }
  }))

  return c.json({ results })
})
