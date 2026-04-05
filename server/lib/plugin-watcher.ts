import { watch, existsSync, type FSWatcher } from "node:fs"
import { join } from "node:path"
import { loadPlugins } from "./plugin-loader.js"
import { mountPluginRoutes } from "../routes/plugins.js"
import type { Hono } from "hono"
import type { AppBindings } from "../lib/workspace-context.js"

const watchers: FSWatcher[] = []
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Watch workspace plugin directories for changes and hot-reload.
 * Watches only the top-level plugins/ dir (non-recursive) to avoid EMFILE.
 * Debounces reload by 500ms to avoid thrashing on rapid saves.
 */
export function watchPlugins(
  workspaces: { id: string; path: string }[],
  app: Hono<AppBindings>,
): void {
  for (const ws of workspaces) {
    const pluginsDir = join(ws.path, "plugins")
    if (!existsSync(pluginsDir)) continue

    try {
      const watcher = watch(pluginsDir, { recursive: true }, (_event, filename) => {
        if (!filename) return
        // Ignore node_modules and hidden files
        if (filename.includes("node_modules") || filename.startsWith(".")) return
        scheduleReload(ws, app)
      })
      watcher.on("error", (err) => {
        console.warn(`[plugin-watcher] Watcher error for ${pluginsDir}:`, err.message)
      })
      watchers.push(watcher)
    } catch (err: unknown) {
      console.warn(`[plugin-watcher] Failed to watch ${pluginsDir}:`, err instanceof Error ? err.message : String(err))
    }
  }
}

function scheduleReload(ws: { id: string; path: string }, app: Hono<AppBindings>) {
  clearTimeout(debounceTimers.get(ws.id))
  debounceTimers.set(ws.id, setTimeout(async () => {
    console.log(`[plugin-watcher] Reloading plugins for ${ws.id}…`)
    try {
      await loadPlugins(ws.path, ws.id)
      mountPluginRoutes(app)
      console.log(`[plugin-watcher] Plugins reloaded for ${ws.id}`)
    } catch (err) {
      console.error(`[plugin-watcher] Failed to reload plugins for ${ws.id}:`, err)
    }
  }, 500))
}

/** Stop all watchers (for graceful shutdown). */
export function stopWatching(): void {
  for (const t of debounceTimers.values()) clearTimeout(t)
  debounceTimers.clear()
  for (const w of watchers) w.close()
  watchers.length = 0
}
