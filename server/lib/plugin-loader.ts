import { readdir } from "node:fs/promises"
import { join } from "node:path"
import type { SourcePlugin } from "../../src/types/plugin.js"

type Importer = (path: string) => Promise<{ default: SourcePlugin }>

const registry = new Map<string, SourcePlugin>()

function isValidPlugin(p: unknown): p is SourcePlugin {
  if (!p || typeof p !== "object") return false
  const plugin = p as Record<string, unknown>
  return (
    typeof plugin.id === "string" &&
    plugin.id.length > 0 &&
    typeof plugin.query === "function"
  )
}

export async function loadPlugins(
  workspacePath: string,
  importer: Importer = (p) => import(p)
): Promise<void> {
  registry.clear()

  const pluginsDir = join(workspacePath, "inbox-plugins")

  let files: string[]
  try {
    files = await readdir(pluginsDir)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return
    throw err
  }

  for (const file of files) {
    if (!file.endsWith(".ts") && !file.endsWith(".js")) continue
    const fullPath = join(pluginsDir, file)
    try {
      const mod = await importer(fullPath)
      const plugin = mod.default
      if (!isValidPlugin(plugin)) {
        console.warn(`plugin-loader: skipping ${file} — missing id or query`)
        continue
      }
      registry.set(plugin.id, plugin)
    } catch (err: unknown) {
      console.error(`plugin-loader: failed to load ${file}:`, err)
    }
  }
}

export function getPlugins(): SourcePlugin[] {
  return [...registry.values()]
}

export function getPlugin(id: string): SourcePlugin | undefined {
  return registry.get(id)
}

// Exposed for test isolation only — do not call in production
;(loadPlugins as unknown as Record<string, unknown>).__resetForTest = () => registry.clear()
