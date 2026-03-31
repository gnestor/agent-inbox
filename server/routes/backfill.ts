import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { mkdir, writeFile } from "fs/promises"
import { join } from "path"
import { queryOne, execute } from "../db/pool.js"
import { getPlugins, getPlugin } from "../lib/plugin-loader.js"
import { buildPluginContext, getWorkspaceId, getWorkspacePath } from "../lib/plugin-context.js"
import type { Plugin, PluginContext } from "../../src/types/plugin.js"

async function runBackfill(
  plugin: Plugin,
  workspacePath: string,
  ctx: PluginContext,
): Promise<{ processed: number; total: number; nextCursor: string | null }> {
  const row = await queryOne<{ cursor: string | null }>(
    "SELECT cursor FROM backfill_state WHERE plugin_id = $1",
    [plugin.id],
  )

  const result = await plugin.query!({}, row?.cursor ?? undefined, ctx)

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
  await execute(
    `INSERT INTO backfill_state (plugin_id, cursor, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (plugin_id) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = EXCLUDED.updated_at`,
    [plugin.id, nextCursor, new Date().toISOString()],
  )

  return { processed, total: result.items.length, nextCursor }
}

export const backfillRoutes = new Hono()

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
  const result = await runBackfill(plugin, workspacePath, ctx)
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
      results[plugin.id] = await runBackfill(plugin, workspacePath, ctx)
    } catch (err) {
      results[plugin.id] = { error: (err as Error).message }
    }
  }))

  return c.json({ results })
})
