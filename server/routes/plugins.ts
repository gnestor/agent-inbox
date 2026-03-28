import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { getPlugins, getPlugin } from "../lib/plugin-loader.js"
import { getUserCredential } from "../lib/vault.js"
import { refreshGoogleToken } from "../lib/credentials.js"
import { get as cacheGet, set as cacheSet, invalidate as cacheInvalidate } from "../lib/cache.js"
import type { PluginContext } from "../../src/types/plugin.js"
import { stat } from "node:fs/promises"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Built-in plugins root (packages/inbox/plugins/)
const BUILTIN_PLUGINS_ROOT = resolve(__dirname, "../../plugins")

// Cache: pluginId:componentName:path → { js, mtime }. Capped at 100 entries (LRU-ish eviction).
const componentCache = new Map<string, { js: string; mtime: number }>()
const COMPONENT_CACHE_MAX = 100

const PLUGIN_CACHE_TTL = 24 * 60 * 60 * 1000 // 24h default

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
    cache: {
      async get<T>(key: string): Promise<T | null> {
        return cacheGet<T>(key)
      },
      async set<T>(key: string, value: T, ttlMs = PLUGIN_CACHE_TTL): Promise<void> {
        return cacheSet(key, value, ttlMs)
      },
      async invalidate(key: string): Promise<void> {
        return cacheInvalidate(key)
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Auto-generated routes for all plugins, mounted at /api/:pluginId/*
// ---------------------------------------------------------------------------

export const pluginRoutes = new Hono()

/** GET /api/plugins — list all loaded plugin manifests that have a UI (fieldSchema present) */
pluginRoutes.get("/plugins", (c) => {
  const workspace = c.get("workspace") as { id: string } | undefined
  const plugins = getPlugins(workspace?.id)
    .filter((p) => p.fieldSchema && p.fieldSchema.length > 0)
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

/**
 * GET /api/:pluginId/components/:name
 * Serve a plugin's TSX component as an ES module (esbuild-transformed).
 * Used by PluginFrame to load component scripts inside sandboxed iframes.
 */
pluginRoutes.get("/:pluginId/components/:name", async (c) => {
  const { pluginId, name } = c.req.param()
  const workspace = c.get("workspace") as { id: string; path: string } | undefined

  // Resolve component path and mtime in one pass — workspace takes priority over built-in
  let componentPath: string
  let mtime: number

  const candidates = [
    workspace && join(workspace.path, "plugins", pluginId, "app", "components", `${name}.tsx`),
    join(BUILTIN_PLUGINS_ROOT, pluginId, "app", "components", `${name}.tsx`),
  ].filter(Boolean) as string[]

  let resolved = false
  for (const candidate of candidates) {
    try {
      const s = await stat(candidate)
      componentPath = candidate
      mtime = s.mtimeMs
      resolved = true
      break
    } catch {
      // Not found — try next candidate
    }
  }

  if (!resolved) {
    throw new HTTPException(404, { message: `Component "${name}" not found for plugin "${pluginId}"` })
  }

  const cacheKey = `${pluginId}:${name}:${componentPath!}`
  const cached = componentCache.get(cacheKey)

  if (cached && cached.mtime === mtime) {
    return new Response(cached.js, {
      headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" },
    })
  }

  // Transform with esbuild
  const result = await build({
    entryPoints: [componentPath],
    bundle: true,
    format: "esm",
    jsx: "automatic",
    external: ["react", "react-dom", "react-dom/client", "@hammies/frontend/*"],
    platform: "browser",
    target: "es2020",
    write: false,
  })

  const js = result.outputFiles[0].text
  if (componentCache.size >= COMPONENT_CACHE_MAX) {
    const first = componentCache.keys().next().value
    if (first) componentCache.delete(first)
  }
  componentCache.set(cacheKey, { js, mtime })

  return new Response(js, {
    headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" },
  })
})

/** GET /api/:pluginId/items — query items with optional filters + cursor */
pluginRoutes.get("/:pluginId/items", async (c) => {
  const { pluginId } = c.req.param()
  const plugin = getPlugin(pluginId, (c.get("workspace") as { id: string } | undefined)?.id)
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${pluginId}" not found` })

  const raw = c.req.query()
  const cursor = raw.cursor
  const filters = Object.fromEntries(
    Object.entries(raw).filter(([k]) => k !== "cursor")
  )

  if (!plugin.query) throw new HTTPException(404, { message: `Plugin "${pluginId}" does not support querying items` })
  const ctx = await buildPluginContext(c)
  const result = await plugin.query(filters, cursor, ctx)
  return c.json(result)
})

/** GET /api/:pluginId/items/:itemId — get a single item by ID */
pluginRoutes.get("/:pluginId/items/:itemId", async (c) => {
  const { pluginId, itemId } = c.req.param()
  const plugin = getPlugin(pluginId, (c.get("workspace") as { id: string } | undefined)?.id)
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
  const plugin = getPlugin(pluginId, (c.get("workspace") as { id: string } | undefined)?.id)
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
  const plugin = getPlugin(pluginId, (c.get("workspace") as { id: string } | undefined)?.id)
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${pluginId}" not found` })

  if (!plugin.mutate) throw new HTTPException(404, { message: `Plugin "${pluginId}" does not support mutations` })

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
  const plugin = getPlugin(pluginId, (c.get("workspace") as { id: string } | undefined)?.id)
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
