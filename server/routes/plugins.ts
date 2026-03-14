import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { getPlugins, getPlugin } from "../lib/plugin-loader.js"

export const pluginRoutes = new Hono()

/** GET /api/plugins — list all loaded plugin manifests */
pluginRoutes.get("/", (c) => {
  const plugins = getPlugins().map((p) => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    fieldSchema: p.fieldSchema,
    detailSchema: p.detailSchema,
    hasSubItems: !!p.querySubItems,
  }))
  return c.json(plugins)
})

/** GET /api/plugins/:sourceId/items — query items with optional filters + cursor */
pluginRoutes.get("/:sourceId/items", async (c) => {
  const { sourceId } = c.req.param()
  const plugin = getPlugin(sourceId)
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${sourceId}" not found` })

  const raw = c.req.query()
  const cursor = raw.cursor
  const filters = Object.fromEntries(
    Object.entries(raw).filter(([k]) => k !== "cursor")
  )

  const result = await plugin.query(filters, cursor)
  return c.json(result)
})

/** GET /api/plugins/:sourceId/items/:itemId/subitems — query sub-items (e.g. messages in a channel) */
pluginRoutes.get("/:sourceId/items/:itemId/subitems", async (c) => {
  const { sourceId, itemId } = c.req.param()
  const plugin = getPlugin(sourceId)
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${sourceId}" not found` })
  if (!plugin.querySubItems) throw new HTTPException(404, { message: `Plugin "${sourceId}" does not support sub-items` })

  const raw = c.req.query()
  const cursor = raw.cursor
  const filters = Object.fromEntries(
    Object.entries(raw).filter(([k]) => k !== "cursor")
  )

  const result = await plugin.querySubItems(itemId, filters, cursor)
  return c.json(result)
})

/** POST /api/plugins/:sourceId/items/:itemId/mutate — perform an item mutation */
pluginRoutes.post("/:sourceId/items/:itemId/mutate", async (c) => {
  const { sourceId, itemId } = c.req.param()
  const plugin = getPlugin(sourceId)
  if (!plugin) throw new HTTPException(404, { message: `Plugin "${sourceId}" not found` })

  const { action, payload } = await c.req.json()
  if (!action) throw new HTTPException(400, { message: "action is required" })

  await plugin.mutate(itemId, action, payload)
  return c.json({ ok: true })
})
