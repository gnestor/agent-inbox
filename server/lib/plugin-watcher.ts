import { watch, existsSync, type FSWatcher } from "node:fs"
import { join } from "node:path"
import { loadPlugins } from "./plugin-loader.js"
import { mountPluginRoutes } from "../routes/plugins.js"
import type { Hono } from "hono"
import type { AppBindings } from "../lib/workspace-context.js"

const watchers: FSWatcher[] = []
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Paths (relative to the watched plugins/ dir) that must NOT trigger a reload:
 * dependency, build, and runtime-state/log churn under a plugin. A recursive
 * watch fires on every nested write, so on the Mini a running Meltano tap
 * writing to `plugins/meltano/.meltano/**` + `plugins/meltano/logs/**` (and any
 * `temp/` logs) would otherwise thrash a reload every second. The check is
 * per-path-segment, so it catches NESTED dot-dirs like `meltano/.meltano/…` —
 * a plain `filename.startsWith(".")` misses those (the string starts with "m").
 */
function isIgnoredChange(filename: string): boolean {
  return filename
    .split(/[/\\]/)
    .some((seg) => seg.startsWith(".") || seg === "node_modules" || seg === "temp" || seg === "logs" || seg === "dist")
}

/**
 * Watch workspace plugin directories for plugin-source changes and hot-reload.
 * Recursive (on macOS `fs.watch` uses one FSEvents watcher for the whole tree,
 * so no EMFILE), but reloads only on real source edits — `isIgnoredChange`
 * filters out dependency/build/state/log churn. Debounces 500ms to coalesce
 * rapid saves.
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
        if (!filename || isIgnoredChange(filename)) return
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
