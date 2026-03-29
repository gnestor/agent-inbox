import { watch, readdirSync, existsSync, type FSWatcher } from "node:fs"
import { join } from "node:path"
import { loadPlugins } from "./plugin-loader.js"
import { mountPluginRoutes } from "../routes/plugins.js"
import type { Hono } from "hono"

const watchers: FSWatcher[] = []
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Watch workspace plugin directories for changes and hot-reload.
 * Watches only the top-level plugins/ dir (non-recursive) to avoid EMFILE.
 * Debounces reload by 500ms to avoid thrashing on rapid saves.
 */
export function watchPlugins(
  workspaces: { id: string; path: string }[],
  app: Hono<any>,
): void {
  for (const ws of workspaces) {
    const pluginsDir = join(ws.path, "plugins")
    if (!existsSync(pluginsDir)) continue

    try {
      // Use non-recursive watch to avoid EMFILE with large plugin dirs.
      // This catches renames/creates/deletes of plugin subdirectories.
      const watcher = watch(pluginsDir, { recursive: false }, (_event, filename) => {
        if (!filename) return
        scheduleReload(ws, app)
      })
      watcher.on("error", (err) => {
        console.warn(`[plugin-watcher] Watcher error for ${pluginsDir}:`, err.message)
      })
      watchers.push(watcher)

      // Also watch each plugin's plugin.ts directly for edits
      try {
        for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue
          for (const name of ["plugin.ts", "plugin.js"]) {
            const pluginFile = join(pluginsDir, entry.name, name)
            if (!existsSync(pluginFile)) continue
            try {
              const fw = watch(pluginFile, () => scheduleReload(ws, app))
              fw.on("error", () => {}) // ignore individual file watch errors
              watchers.push(fw)
            } catch {}
            break
          }
        }
      } catch {}

      console.log(`[plugin-watcher] Watching ${pluginsDir}`)
    } catch (err: any) {
      console.warn(`[plugin-watcher] Failed to watch ${pluginsDir}:`, err.message)
    }
  }
}

function scheduleReload(ws: { id: string; path: string }, app: Hono<any>) {
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
