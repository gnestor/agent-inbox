import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { getPlugins } from "../lib/plugin-loader.js"
import { query, execute } from "../db/pool.js"
import type { PluginContext } from "../../src/types/plugin.js"
import type { WorkspaceContext } from "../lib/workspace-context.js"

// ---------------------------------------------------------------------------
// Context backfill route — POST /api/context/backfill
// ---------------------------------------------------------------------------

export const contextRoutes = new Hono()

interface BackfillState {
  plugin_id: string
  workspace_id: string
  last_run_at: string
  total_indexed: number
  last_cursor: string | null
  updated_at: string
}

interface BackfillResult {
  pluginId: string
  itemsIndexed: number
  itemsSkipped: number
  errors: number
  durationMs: number
}

async function getBackfillState(
  pluginId: string,
  workspaceId: string,
): Promise<BackfillState | undefined> {
  const rows = await query<BackfillState>(
    "SELECT * FROM backfill_state WHERE plugin_id = $1 AND workspace_id = $2",
    [pluginId, workspaceId],
  )
  return rows[0]
}

async function upsertBackfillState(
  pluginId: string,
  workspaceId: string,
  totalIndexed: number,
  lastCursor: string | null,
): Promise<void> {
  const now = new Date().toISOString()
  await execute(
    `INSERT INTO backfill_state (plugin_id, workspace_id, last_run_at, total_indexed, last_cursor, updated_at)
     VALUES ($1, $2, $3, $4, $5, $3)
     ON CONFLICT (plugin_id, workspace_id) DO UPDATE SET
       last_run_at = $3,
       total_indexed = $4,
       last_cursor = $5,
       updated_at = $3`,
    [pluginId, workspaceId, now, totalIndexed, lastCursor],
  )
}

/**
 * Backfill a single plugin for a given workspace.
 * Paginates through query() and calls itemToContext() for each item.
 * Writes markdown files to {workspacePath}/context/{pluginId}/{itemId}.md.
 */
async function backfillPlugin(
  pluginId: string,
  ctx: PluginContext,
  workspaceId: string,
  workspacePath: string,
): Promise<BackfillResult> {
  const start = Date.now()
  const plugin = getPlugins(workspaceId).find((p) => p.id === pluginId)

  if (!plugin) throw new HTTPException(404, { message: `Plugin "${pluginId}" not found` })
  if (!plugin.query) throw new HTTPException(400, { message: `Plugin "${pluginId}" has no query method` })
  if (!plugin.itemToContext) throw new HTTPException(400, { message: `Plugin "${pluginId}" has no itemToContext method` })

  const contextDir = join(workspacePath, "context", pluginId)
  await mkdir(contextDir, { recursive: true })

  let cursor: string | undefined
  let itemsIndexed = 0
  let itemsSkipped = 0
  let errors = 0

  // Paginate through all items
  while (true) {
    let result: Awaited<ReturnType<NonNullable<typeof plugin.query>>>
    try {
      result = await plugin.query({}, cursor, ctx)
    } catch (err) {
      console.error(`backfill: query error for plugin "${pluginId}":`, err)
      errors++
      break
    }

    for (const item of result.items) {
      try {
        const markdown = plugin.itemToContext!(item)
        if (markdown === null) {
          itemsSkipped++
          continue
        }
        const filePath = join(contextDir, `${item.id}.md`)
        await writeFile(filePath, markdown, "utf-8")
        itemsIndexed++
      } catch (err) {
        console.error(`backfill: error processing item "${item.id}" for plugin "${pluginId}":`, err)
        errors++
      }
    }

    // Track progress after each page
    await upsertBackfillState(pluginId, workspaceId, itemsIndexed, result.nextCursor ?? null)

    if (!result.nextCursor) break
    cursor = result.nextCursor
  }

  return {
    pluginId,
    itemsIndexed,
    itemsSkipped,
    errors,
    durationMs: Date.now() - start,
  }
}

/**
 * POST /api/context/backfill
 * Optional query param: pluginId — backfill one plugin or all eligible plugins.
 * Eligible = has query() and itemToContext().
 */
contextRoutes.post("/backfill", async (c) => {
  const userEmail = c.get("userEmail") as string
  const workspace = c.get("workspace") as WorkspaceContext | undefined

  if (!workspace) {
    throw new HTTPException(400, { message: "No active workspace. Select a workspace first." })
  }

  const targetPluginId = c.req.query("pluginId")

  // Build a minimal PluginContext (no cache needed for backfill)
  const ctx: PluginContext = {
    userEmail,
    async getCredential(integration: string): Promise<string | null> {
      // Dynamic import to avoid circular deps — plugins route already has this logic
      const { getUserCredential } = await import("../lib/vault.js")
      const { refreshGoogleToken } = await import("../lib/credentials.js")
      const cred = await getUserCredential(userEmail, integration)
      if (cred?.refreshToken && integration === "google") {
        return refreshGoogleToken(cred.refreshToken)
      }
      return cred?.refreshToken ?? null
    },
    cache: {
      async get<T>(key: string): Promise<T | null> {
        const { get } = await import("../lib/cache.js")
        return get<T>(key)
      },
      async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
        const { set } = await import("../lib/cache.js")
        return set(key, value, ttlMs)
      },
      async invalidate(key: string): Promise<void> {
        const { invalidate } = await import("../lib/cache.js")
        return invalidate(key)
      },
    },
  }

  const eligiblePlugins = getPlugins(workspace.id).filter(
    (p) => p.query && p.itemToContext,
  )

  const toBackfill = targetPluginId
    ? eligiblePlugins.filter((p) => p.id === targetPluginId)
    : eligiblePlugins

  if (targetPluginId && toBackfill.length === 0) {
    throw new HTTPException(404, {
      message: `Plugin "${targetPluginId}" not found or not eligible for backfill`,
    })
  }

  const results: BackfillResult[] = []

  for (const plugin of toBackfill) {
    try {
      const result = await backfillPlugin(plugin.id, ctx, workspace.id, workspace.path)
      results.push(result)
    } catch (err) {
      results.push({
        pluginId: plugin.id,
        itemsIndexed: 0,
        itemsSkipped: 0,
        errors: 1,
        durationMs: 0,
      })
      console.error(`backfill: plugin "${plugin.id}" failed:`, err)
    }
  }

  return c.json({ results })
})

/**
 * GET /api/context/backfill/state
 * Returns backfill state for all plugins in the active workspace.
 */
contextRoutes.get("/backfill/state", async (c) => {
  const workspace = c.get("workspace") as WorkspaceContext | undefined

  if (!workspace) {
    throw new HTTPException(400, { message: "No active workspace" })
  }

  const states = await query<BackfillState>(
    "SELECT * FROM backfill_state WHERE workspace_id = $1",
    [workspace.id],
  )

  return c.json({ states })
})
