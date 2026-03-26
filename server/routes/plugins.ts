import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { getPlugins, getPlugin } from "../lib/plugin-loader.js"
import { getUserCredential } from "../lib/vault.js"
import { refreshGoogleToken } from "../lib/credentials.js"
import type { PluginContext, SkillManifest } from "../../src/types/plugin.js"

/**
 * Build a PluginContext from the Hono request context.
 * The auth middleware has already set userEmail on all /api/* routes.
 */
async function buildPluginContext(c: { get: (key: string) => unknown }): Promise<PluginContext> {
  const userEmail = c.get("userEmail") as string
  return {
    userEmail,
    async getCredential(integration: string): Promise<string | null> {
      // Per-user OAuth credential (e.g. Google)
      const cred = await getUserCredential(userEmail, integration)
      if (cred?.refreshToken) {
        if (integration === "google") {
          return refreshGoogleToken(cred.refreshToken)
        }
        return cred.refreshToken
      }
      return null
    },
  }
}

// ---------------------------------------------------------------------------
// Auto-generated routes for all plugins, mounted at /api/:pluginId/*
// ---------------------------------------------------------------------------

export const pluginRoutes = new Hono()

/** GET /api/plugins — list all loaded plugin manifests (data-source plugins only, excludes skills-only) */
pluginRoutes.get("/plugins", (c) => {
  // Filter out skills-only plugins (those without query) — they don't appear as tabs
  const plugins = getPlugins()
    .filter((p) => typeof p.query === "function")
    .map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      emoji: p.emoji,
      components: p.components,
      auth: p.auth,
      fieldSchema: p.fieldSchema,
      detailSchema: p.detailSchema,
      hasSubItems: !!p.querySubItems,
      hasGetItem: !!p.getItem,
      hasFilterOptions: !!p.filterOptions,
    }))
  return c.json(plugins)
})

/** GET /api/plugins/skills — list skill manifests across all plugins, with optional ?category= filter */
pluginRoutes.get("/plugins/skills", (c) => {
  const categoryFilter = c.req.query("category")
  const result: (SkillManifest & { pluginId: string })[] = []

  for (const plugin of getPlugins()) {
    if (!plugin.skillManifest) continue
    for (const skill of plugin.skillManifest) {
      if (categoryFilter && skill.category !== categoryFilter) continue
      result.push({ ...skill, pluginId: plugin.id })
    }
  }

  return c.json(result)
})

/** GET /api/:pluginId/items — query items with optional filters + cursor */
pluginRoutes.get("/:pluginId/items", async (c) => {
  const { pluginId } = c.req.param()
  const plugin = getPlugin(pluginId)
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${pluginId}" not found` })
  if (!plugin.query) throw new HTTPException(404, { message: `Plugin "${pluginId}" does not support query` })

  const raw = c.req.query()
  const cursor = raw.cursor
  const filters = Object.fromEntries(
    Object.entries(raw).filter(([k]) => k !== "cursor")
  )

  const ctx = await buildPluginContext(c)
  const result = await plugin.query(filters, cursor, ctx)
  return c.json(result)
})

/** GET /api/:pluginId/items/:itemId — get a single item by ID */
pluginRoutes.get("/:pluginId/items/:itemId", async (c) => {
  const { pluginId, itemId } = c.req.param()
  const plugin = getPlugin(pluginId)
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${pluginId}" not found` })
  if (!plugin.getItem) throw new HTTPException(404, { message: `Plugin "${pluginId}" does not support getItem` })

  const ctx = await buildPluginContext(c)
  const item = await plugin.getItem(itemId, ctx)
  if (!item) throw new HTTPException(404, { message: `Item "${itemId}" not found` })
  return c.json(item)
})

/** GET /api/:pluginId/items/:itemId/subitems — query sub-items (e.g. messages in a channel) */
pluginRoutes.get("/:pluginId/items/:itemId/subitems", async (c) => {
  const { pluginId, itemId } = c.req.param()
  const plugin = getPlugin(pluginId)
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${pluginId}" not found` })
  if (!plugin.querySubItems) throw new HTTPException(404, { message: `Plugin "${pluginId}" does not support sub-items` })

  const raw = c.req.query()
  const cursor = raw.cursor
  const filters = Object.fromEntries(
    Object.entries(raw).filter(([k]) => k !== "cursor")
  )

  const ctx = await buildPluginContext(c)
  const result = await plugin.querySubItems(itemId, filters, cursor, ctx)
  return c.json(result)
})

/** POST /api/:pluginId/items/:itemId/mutate — perform an item mutation */
pluginRoutes.post("/:pluginId/items/:itemId/mutate", async (c) => {
  const { pluginId, itemId } = c.req.param()
  const plugin = getPlugin(pluginId)
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${pluginId}" not found` })
  if (!plugin.mutate) throw new HTTPException(404, { message: `Plugin "${pluginId}" does not support mutate` })

  const { action, payload } = await c.req.json()
  if (!action) throw new HTTPException(400, { message: "action is required" })

  const ctx = await buildPluginContext(c)

  // Validate payload against plugin-declared schema if available
  const schema = plugin.actionSchemas?.[action]
  if (schema) {
    const result = schema.safeParse(payload)
    if (!result.success) {
      throw new HTTPException(400, {
        message: `Invalid payload for action "${action}": ${result.error.issues.map(i => i.message).join(", ")}`,
      })
    }
    await plugin.mutate(itemId, action, result.data, ctx)
  } else {
    await plugin.mutate(itemId, action, payload, ctx)
  }
  return c.json({ ok: true })
})

/** GET /api/:pluginId/fields/:fieldId/options — fetch dynamic filter options */
pluginRoutes.get("/:pluginId/fields/:fieldId/options", async (c) => {
  const { pluginId, fieldId } = c.req.param()
  const plugin = getPlugin(pluginId)
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${pluginId}" not found` })

  const fetcher = plugin.filterOptions?.[fieldId]
  if (!fetcher) throw new HTTPException(404, { message: `Plugin "${pluginId}" has no filter options for "${fieldId}"` })

  const ctx = await buildPluginContext(c)
  const options = await fetcher(ctx)
  return c.json({ options })
})

const mountedPluginIds = new Set<string>()

/**
 * Mount custom plugin routes. Called during server startup after plugins are loaded.
 * Each plugin's routes() is mounted under /api/:pluginId/
 * Safe to call multiple times — already-mounted plugins are skipped.
 */
export function mountPluginRoutes(app: Hono<any>): void {
  for (const plugin of getPlugins()) {
    if (!plugin.routes) continue
    if (mountedPluginIds.has(plugin.id)) continue
    mountedPluginIds.add(plugin.id)
    const sub = new Hono()
    plugin.routes(sub, {
      getContext: (c: unknown) => buildPluginContext(c as { get: (key: string) => unknown }),
    })
    app.route(`/api/${plugin.id}`, sub)
  }
}
