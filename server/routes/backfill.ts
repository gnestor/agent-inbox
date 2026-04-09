import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { mkdir, writeFile } from "fs/promises"
import { join } from "path"
import { queryOne, execute } from "../db/pool.js"
import { getPlugins, getPlugin } from "../lib/plugin-loader.js"
import { buildPluginContext, getWorkspaceId, getWorkspacePath } from "../lib/plugin-context.js"
import type { Plugin, PluginContext } from "../../src/types/plugin.js"

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

  // When last_run_at exists, pass it as `since` so plugins fetch only modified records.
  // Don't pass the old pagination cursor — time-based filter replaces it (old cursors expire).
  const filters: Record<string, string> = {}
  if (row?.last_run_at) filters.since = row.last_run_at

  const cursor = row?.last_run_at ? undefined : (row?.last_cursor ?? undefined)
  const result = await plugin.query!(filters, cursor, ctx)

  const contextDir = join(workspacePath, "context", plugin.id)
  await mkdir(contextDir, { recursive: true })

  const writes = result.items.map(async (item) => {
    const markdown = plugin.itemToContext!(item)
    if (!markdown) return false
    await writeFile(join(contextDir, `${item.id}.md`), markdown)
    return true
  })
  const results = await Promise.all(writes)
  const processed = results.filter(Boolean).length

  const nextCursor = result.nextCursor ?? null
  const now = new Date().toISOString()
  await execute(
    `INSERT INTO backfill_state (plugin_id, workspace_id, last_cursor, last_run_at, total_indexed, updated_at)
     VALUES ($1, $2, $3, $4, $5, $4)
     ON CONFLICT (plugin_id, workspace_id) DO UPDATE
       SET last_cursor = EXCLUDED.last_cursor,
           last_run_at = EXCLUDED.last_run_at,
           total_indexed = backfill_state.total_indexed + EXCLUDED.total_indexed,
           updated_at = EXCLUDED.updated_at`,
    [plugin.id, wsId, nextCursor, now, processed],
  )

  return { processed, total: result.items.length, nextCursor }
}

export const backfillRoutes = new Hono()

/** POST /api/backfill/curate — launch a curation session to update curated context pages */
backfillRoutes.post("/curate", async (c) => {
  const workspacePath = getWorkspacePath(c)
  if (!workspacePath) throw new HTTPException(400, { message: "No active workspace" })

  const { runCuratedUpdate } = await import("../lib/context-backfill-scheduler.js")
  const result = await runCuratedUpdate(workspacePath, getWorkspaceId(c))
  return c.json(result)
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
