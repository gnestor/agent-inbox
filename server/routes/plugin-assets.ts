/**
 * Serve workspace-plugin static assets (integration icons) at
 * `GET /api/plugin-assets/:id/*`, mirroring Studio's
 * `/api/_studio/plugins/:id/assets/*`. Inbox doesn't run Studio's plugin loader,
 * so the plugin-root dirs come from `discoverWorkspacePluginIntegrations` (which
 * now returns each plugin's `dir`); `index.ts` builds the name→dir map at boot.
 *
 * The ext allowlist + path-traversal check live in `@hammies/auth`'s shared
 * `resolvePluginAsset`, so inbox and Studio can't drift on that security check.
 */
import { Hono } from "hono"
import { resolvePluginAsset } from "@hammies/auth/server"
import type { AppBindings } from "../lib/workspace-context.js"

/** URL an inbox client fetches for a plugin's icon asset — wired as the registry `assetUrl`. */
export function inboxPluginAssetUrl(pluginId: string, assetPath: string): string {
  return `/api/plugin-assets/${pluginId}/${assetPath.replace(/^\.?\//, "")}`
}

/** Route factory. `dirsByName` maps a plugin's registered name to its filesystem root. */
export function pluginAssetRoutes(dirsByName: Map<string, string>): Hono<AppBindings> {
  const app = new Hono<AppBindings>()

  app.get("/plugin-assets/:id/*", async (c) => {
    const dir = dirsByName.get(c.req.param("id"))
    if (!dir) return c.json({ error: "Unknown plugin" }, 404)

    // Path after ".../plugin-assets/:id/", decoded by the router.
    const rel = c.req.path.split(`/plugin-assets/${c.req.param("id")}/`).slice(1).join("/")
    const asset = await resolvePluginAsset(dir, rel)
    if (!asset) return c.json({ error: "Not found" }, 404)

    return c.body(asset.body, 200, {
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=3600",
    })
  })

  return app
}
