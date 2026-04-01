import { readdir } from "node:fs/promises"
import { join } from "node:path"
import type { Plugin } from "../../src/types/plugin.js"

type Importer = (path: string) => Promise<{ default: Plugin | Plugin[] }>

const registry = new Map<string, Plugin>()
const builtinIds = new Set<string>()
// Maps plugin ID → directory path (for component resolution)
const pluginDirs = new Map<string, string>()

// Per-workspace plugin registries (workspace ID → plugin map)
const workspacePluginRegistries = new Map<string, Map<string, Plugin>>()

function isValidPlugin(p: unknown): p is Plugin {
  if (!p || typeof p !== "object") return false
  const plugin = p as Record<string, unknown>
  return (
    typeof plugin.id === "string" &&
    plugin.id.length > 0 &&
    (typeof plugin.query === "function" ||
     plugin.hasSkills === true ||
     typeof plugin.itemToContext === "function")
  )
}

/** Normalize a default export to an array of plugins. */
function toPluginArray(exported: Plugin | Plugin[]): Plugin[] {
  return Array.isArray(exported) ? exported : [exported]
}

/** Register a built-in plugin (survives loadPlugins reloads). */
export function registerPlugin(plugin: Plugin): void {
  registry.set(plugin.id, plugin)
  builtinIds.add(plugin.id)
}

/**
 * Load built-in plugins from a directory (e.g. packages/inbox/plugins/).
 * These are registered as built-in (survive workspace reloads).
 */
export async function loadBuiltinPlugins(
  builtinDir: string,
  importer: Importer = (p) => import(p)
): Promise<void> {
  try {
    const entries = await readdir(builtinDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      for (const filename of ["plugin.ts", "plugin.js"]) {
        const fullPath = join(builtinDir, entry.name, filename)
        try {
          const mod = await importer(fullPath)
          const plugins = toPluginArray(mod.default)
          for (const plugin of plugins) {
            if (!isValidPlugin(plugin)) {
              console.warn(`plugin-loader: skipping builtin ${entry.name}/${filename} plugin "${(plugin as any)?.id ?? "?"}" — invalid`)
              continue
            }
            registerPlugin(plugin)
            pluginDirs.set(plugin.id, join(builtinDir, entry.name))
          }
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT" ||
              (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") continue
          console.error(`plugin-loader: failed to load builtin ${entry.name}/${filename}:`, err)
        }
        break
      }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
}

export async function loadPlugins(
  workspacePath: string,
  workspaceId?: string,
  importer: Importer = (p) => import(p)
): Promise<void> {
  // If workspace ID provided, load into per-workspace registry
  const targetRegistry = workspaceId ? new Map<string, Plugin>() : registry

  if (!workspaceId) {
    // Clear only non-builtin plugins (workspace plugins may change on reload)
    for (const id of registry.keys()) {
      if (!builtinIds.has(id)) registry.delete(id)
    }
  }

  // Scan {workspace}/plugins/*/plugin.ts (new convention)
  const pluginsDir = join(workspacePath, "plugins")
  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      for (const filename of ["plugin.ts", "plugin.js"]) {
        const fullPath = join(pluginsDir, entry.name, filename)
        try {
          const mod = await importer(fullPath)
          const plugins = toPluginArray(mod.default)
          for (const plugin of plugins) {
            if (!isValidPlugin(plugin)) {
              console.warn(`plugin-loader: skipping ${entry.name}/${filename} plugin "${(plugin as any)?.id ?? "?"}" — invalid`)
              continue
            }
            if (!builtinIds.has(plugin.id)) {
              targetRegistry.set(plugin.id, plugin)
              pluginDirs.set(plugin.id, join(pluginsDir, entry.name))
            }
          }
        } catch (err: unknown) {
          // ENOENT = file doesn't exist, try next filename; other errors = broken plugin
          if ((err as NodeJS.ErrnoException).code === "ENOENT" ||
              (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") continue
          console.error(`plugin-loader: failed to load ${entry.name}/${filename}:`, err)
        }
        break
      }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }

  // Also scan {workspace}/inbox-plugins/*.ts|js (backward compat)
  const legacyDir = join(workspacePath, "inbox-plugins")
  try {
    const files = await readdir(legacyDir)
    for (const file of files) {
      if (!file.endsWith(".ts") && !file.endsWith(".js")) continue
      const fullPath = join(legacyDir, file)
      try {
        const mod = await importer(fullPath)
        const plugins = toPluginArray(mod.default)
        for (const plugin of plugins) {
          if (!isValidPlugin(plugin)) {
            console.warn(`plugin-loader: skipping ${file} plugin "${(plugin as any)?.id ?? "?"}" — invalid`)
            continue
          }
          if (!targetRegistry.has(plugin.id) && !builtinIds.has(plugin.id)) {
            targetRegistry.set(plugin.id, plugin)
          }
        }
      } catch (err: unknown) {
        console.error(`plugin-loader: failed to load ${file}:`, err)
      }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }

  if (workspaceId) {
    workspacePluginRegistries.set(workspaceId, targetRegistry)
  }
}

/** Get all plugins for a workspace (built-ins merged with workspace-specific). */
export function getPlugins(workspaceId?: string): Plugin[] {
  const builtins = [...registry.values()]
  if (!workspaceId) return builtins
  const wsPlugins = workspacePluginRegistries.get(workspaceId)
  if (!wsPlugins) return builtins
  const merged = new Map<string, Plugin>()
  for (const p of builtins) merged.set(p.id, p)
  for (const [id, p] of wsPlugins) merged.set(id, p)
  return [...merged.values()]
}

/** Get the directory path for a plugin (for component resolution). */
export function getPluginDir(id: string): string | undefined {
  return pluginDirs.get(id)
}

export function getPlugin(id: string, workspaceId?: string): Plugin | undefined {
  if (workspaceId) {
    const wsPlugin = workspacePluginRegistries.get(workspaceId)?.get(id)
    if (wsPlugin) return wsPlugin
  }
  return registry.get(id)
}

// Exposed for test isolation only — do not call in production
;(loadPlugins as unknown as Record<string, unknown>).__resetForTest = () => {
  registry.clear()
  builtinIds.clear()
  workspacePluginRegistries.clear()
  pluginDirs.clear()
}
