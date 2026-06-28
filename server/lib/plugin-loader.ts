import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { Plugin } from "../../src/types/plugin.js"
import { createLogger } from "@hammies/frontend/lib/serverLogger"

const log = createLogger("plugins")

type Importer = (path: string) => Promise<{ default: Plugin | Plugin[] }>

/**
 * Default ESM importer that bypasses Node's module cache. Without the unique
 * `?v=` query, `import(path)` returns the previously-cached module and the
 * plugin watcher's hot-reload becomes a no-op for any plugin that imported
 * cleanly the first time.
 */
const cacheBustingImport: Importer = (path) =>
  import(`${pathToFileURL(path).href}?v=${Date.now()}`) as Promise<{ default: Plugin | Plugin[] }>


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
  importer: Importer = cacheBustingImport
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
              log.warn("Skipping invalid builtin plugin", { dir: entry.name, file: filename, id: (plugin as Record<string, unknown>)?.id ?? "?" })
              continue
            }
            registerPlugin(plugin)
            pluginDirs.set(plugin.id, join(builtinDir, entry.name))
          }
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT" ||
              (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") continue
          log.error("Failed to load builtin plugin", { dir: entry.name, file: filename, error: err instanceof Error ? err.message : String(err) })
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
  importer: Importer = cacheBustingImport
): Promise<void> {
  // If workspace ID provided, load into per-workspace registry
  const targetRegistry = workspaceId ? new Map<string, Plugin>() : registry

  if (!workspaceId) {
    // Clear only non-builtin plugins (workspace plugins may change on reload)
    for (const id of registry.keys()) {
      if (!builtinIds.has(id)) registry.delete(id)
    }
  }

  // Scan {workspace}/inbox/*/plugin.ts (Inbox plugins) and {workspace}/plugins/*/plugin.ts
  // (legacy co-located convention). The agent repo separates the two: Inbox
  // plugins live in `inbox/`, Studio plugins (manifest-only, no plugin.ts) in
  // `plugins/`. Scanning both keeps older workspaces that still co-locate working.
  for (const subdir of ["inbox", "plugins"]) {
    const pluginsDir = join(workspacePath, subdir)
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
                log.warn("Skipping invalid plugin", { dir: entry.name, file: filename, id: (plugin as Record<string, unknown>)?.id ?? "?" })
                continue
              }
              // Workspace plugins are always stored — getPlugins() merges
              // workspace registry on top of builtins so a workspace can
              // override a builtin (e.g. agent's gmail extends inbox builtin
              // gmail with itemToContext + enrichForContext).
              targetRegistry.set(plugin.id, plugin)
              pluginDirs.set(plugin.id, join(pluginsDir, entry.name))
            }
          } catch (err: unknown) {
            // ENOENT = file doesn't exist, try next filename; other errors = broken plugin
            if ((err as NodeJS.ErrnoException).code === "ENOENT" ||
                (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") continue
            log.error("Failed to load plugin", { dir: entry.name, file: filename, error: err instanceof Error ? err.message : String(err) })
          }
          break
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    }
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
            log.warn("Skipping invalid legacy plugin", { file, id: (plugin as Record<string, unknown>)?.id ?? "?" })
            continue
          }
          if (!targetRegistry.has(plugin.id) && !builtinIds.has(plugin.id)) {
            targetRegistry.set(plugin.id, plugin)
          }
        }
      } catch (err: unknown) {
        log.error("Failed to load legacy plugin", { file, error: err instanceof Error ? err.message : String(err) })
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
/**
 * Overlay a workspace plugin on top of a builtin of the same id. A workspace
 * plugin only needs to define the keys it overrides or adds — every other field
 * (methods + metadata) is inherited from the builtin. This is a shallow per-key
 * merge (overlay wins), so e.g. the agent workspace's gmail can override `query`
 * and add `extractEntities`/`curationPrompt` while inheriting the builtin's
 * `filterOptions`, `routes`, `auth`, and `components`. When there's no builtin
 * for the id, the workspace plugin stands alone.
 */
function overlayPlugin(builtin: Plugin | undefined, overlay: Plugin): Plugin {
  return builtin ? { ...builtin, ...overlay } : overlay
}

export function getPlugins(workspaceId?: string): Plugin[] {
  const merged = new Map<string, Plugin>()
  for (const p of registry.values()) merged.set(p.id, p)
  if (workspaceId) {
    const wsPlugins = workspacePluginRegistries.get(workspaceId)
    if (wsPlugins) for (const [id, p] of wsPlugins) merged.set(id, overlayPlugin(registry.get(id), p))
  } else {
    // No workspace ID — merge all workspace registries (fallback)
    for (const wsRegistry of workspacePluginRegistries.values()) {
      for (const [id, p] of wsRegistry) merged.set(id, overlayPlugin(registry.get(id), p))
    }
  }
  return [...merged.values()]
}

/** Get the directory path for a plugin (for component resolution). */
export function getPluginDir(id: string): string | undefined {
  return pluginDirs.get(id)
}

export function getPlugin(id: string, workspaceId?: string): Plugin | undefined {
  if (workspaceId) {
    const wsPlugin = workspacePluginRegistries.get(workspaceId)?.get(id)
    if (wsPlugin) return overlayPlugin(registry.get(id), wsPlugin)
  }
  const builtin = registry.get(id)
  if (builtin) return builtin
  // Fallback: search all workspace registries (handles missing workspace cookie)
  for (const wsRegistry of workspacePluginRegistries.values()) {
    const plugin = wsRegistry.get(id)
    if (plugin) return overlayPlugin(registry.get(id), plugin)
  }
  return undefined
}

// Exposed for test isolation only — do not call in production
;(loadPlugins as unknown as Record<string, unknown>).__resetForTest = () => {
  registry.clear()
  builtinIds.clear()
  workspacePluginRegistries.clear()
  pluginDirs.clear()
}
