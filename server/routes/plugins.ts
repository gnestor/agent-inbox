import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { join, resolve } from "node:path"
import { stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { getPlugins, getPlugin, getPluginDir } from "../lib/plugin-loader.js"
import { buildPluginContext, getWorkspaceId } from "../lib/plugin-context.js"
import type { AppBindings } from "../lib/workspace-context.js"

// ---------------------------------------------------------------------------
// Auto-generated routes for all plugins, mounted at /api/:pluginId/*
// ---------------------------------------------------------------------------

const BUILTIN_PLUGINS_ROOT = resolve(fileURLToPath(import.meta.url), "../../../plugins")
const componentCache = new Map<string, { js: string; mtime: number }>()
const COMPONENT_CACHE_MAX = 50

export const pluginRoutes = new Hono<AppBindings>()

/** GET /api/plugins — list all loaded plugin manifests (excludes skills-only plugins) */
pluginRoutes.get("/plugins", (c) => {
  const workspaceId = getWorkspaceId(c)
  const plugins = getPlugins(workspaceId)
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
      listRowHeight: p.listRowHeight,
      hasSubItems: !!p.querySubItems,
      hasGetItem: !!p.getItem,
      hasFilterOptions: !!p.filterOptions,
    }))
  return c.json(plugins)
})

/**
 * GET /api/:pluginId/components/:name
 * Serve a plugin's TSX component as an ES module (esbuild-transformed).
 */
pluginRoutes.get("/:pluginId/components/:name", async (c) => {
  const { pluginId, name } = c.req.param()
  const workspace = c.get("workspace") as { id?: string; path?: string } | undefined

  // Resolve component file: use plugin's actual directory (handles multi-tab plugins
  // where plugin ID differs from directory name, e.g. "notion-tasks" → "notion/")
  const pluginDir = getPluginDir(pluginId)
  const candidates = [
    pluginDir && join(pluginDir, "app", "components", `${name}.tsx`),
    workspace?.path && join(workspace.path, "plugins", pluginId, "app", "components", `${name}.tsx`),
    join(BUILTIN_PLUGINS_ROOT, pluginId, "app", "components", `${name}.tsx`),
  ].filter(Boolean) as string[]

  let componentPath = ""
  let mtime = 0
  for (const candidate of candidates) {
    try {
      const s = await stat(candidate)
      componentPath = candidate
      mtime = s.mtimeMs
      break
    } catch {}
  }

  if (!componentPath) {
    throw new HTTPException(404, { message: `Component "${name}" not found for plugin "${pluginId}"` })
  }

  const cacheKey = `${pluginId}:${name}:${componentPath}`
  const cached = componentCache.get(cacheKey)
  if (cached && cached.mtime === mtime) {
    return new Response(cached.js, {
      headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" },
    })
  }

  const result = await build({
    entryPoints: [componentPath],
    bundle: true,
    format: "esm",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    tsconfigRaw: '{ "compilerOptions": { "jsx": "react" } }',
    external: ["react", "react-dom", "react-dom/client", "@hammies/frontend/*"],
    banner: { js: 'import React from "react";' },
    platform: "browser",
    target: "es2020",
    write: false,
  })

  const outputFile = result.outputFiles[0]
  if (!outputFile) {
    throw new HTTPException(500, { message: `esbuild produced no output for "${name}"` })
  }
  const js = outputFile.text
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
  const workspaceId = getWorkspaceId(c)
  const plugin = getPlugin(pluginId, workspaceId)
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
  const workspaceId = getWorkspaceId(c)
  const plugin = getPlugin(pluginId, workspaceId)
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
  const workspaceId = getWorkspaceId(c)
  const plugin = getPlugin(pluginId, workspaceId)
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
  const workspaceId = getWorkspaceId(c)
  const plugin = getPlugin(pluginId, workspaceId)
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${pluginId}" not found` })

  if (!plugin.mutate) throw new HTTPException(404, { message: `Plugin "${pluginId}" does not support mutations` })

  let body: { action: string; payload?: unknown }
  try {
    const raw = await c.req.json()
    if (!raw?.action || typeof raw.action !== "string") {
      throw new HTTPException(400, { message: "action is required" })
    }
    body = raw as { action: string; payload?: unknown }
  } catch (err) {
    if (err instanceof HTTPException) throw err
    throw new HTTPException(400, { message: "Invalid request body" })
  }
  const { action, payload } = body

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
  const workspaceId = getWorkspaceId(c)
  const plugin = getPlugin(pluginId, workspaceId)
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
export function mountPluginRoutes(app: Hono<AppBindings>): void {
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
