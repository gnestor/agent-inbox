import { readdir, readFile, access } from "node:fs/promises"
import { join } from "node:path"
import type { Plugin, SkillManifest } from "../../src/types/plugin.js"

type Importer = (path: string) => Promise<{ default: Plugin }>

const registry = new Map<string, Plugin>()
const builtinIds = new Set<string>()

/** Maps plugin id → absolute directory path (populated during loadPlugins) */
const pluginDirMap = new Map<string, string>()

// Per-workspace plugin registries (workspace ID → plugin map)
const workspacePluginRegistries = new Map<string, Map<string, Plugin>>()
const workspacePluginDirs = new Map<string, Map<string, string>>()

function isValidPlugin(p: unknown): p is Plugin {
  if (!p || typeof p !== "object") return false
  const plugin = p as Record<string, unknown>
  if (typeof plugin.id !== "string" || plugin.id.length === 0) return false
  // Valid if it has a query function (data source) OR hasSkills (skills-only)
  return typeof plugin.query === "function" || plugin.hasSkills === true
}

/** Check whether a directory contains a .claude-plugin/plugin.json file. */
async function hasClaudePlugin(dirPath: string): Promise<boolean> {
  try {
    await access(join(dirPath, ".claude-plugin", "plugin.json"))
    return true
  } catch {
    return false
  }
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Frontmatter is delimited by `---` at the start and end of the block.
 * Uses simple string parsing — no external YAML dependency.
 */
function parseSkillFrontmatter(content: string, filePath: string): SkillManifest | null {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith("---")) return null

  const afterFirst = trimmed.slice(3)
  const endIdx = afterFirst.indexOf("\n---")
  if (endIdx === -1) return null

  const yamlBlock = afterFirst.slice(0, endIdx).trim()

  // Simple line-by-line YAML parser for the subset we need
  const result: Record<string, unknown> = {}
  const lines = yamlBlock.split("\n")

  let currentKey: string | null = null
  let currentList: string[] | null = null
  let currentObjList: Record<string, unknown>[] | null = null
  let currentObjListKey: string | null = null

  for (const line of lines) {
    // Top-level key: value
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/)
    if (kvMatch && !line.startsWith(" ") && !line.startsWith("\t")) {
      // Flush previous list
      if (currentKey && currentList) {
        result[currentKey] = currentList
        currentList = null
      }
      if (currentObjListKey && currentObjList) {
        result[currentObjListKey] = currentObjList
        currentObjList = null
        currentObjListKey = null
      }
      currentKey = kvMatch[1]
      const value = kvMatch[2].trim()
      if (value === "" || value === null) {
        // Value on next lines (list or block)
        currentList = null
      } else {
        // Inline value — strip surrounding quotes
        result[currentKey] = value.replace(/^["']|["']$/g, "")
        currentKey = null
      }
      continue
    }

    // Object list item key (e.g. "  - name: foo"): check BEFORE plain list items
    // since "  - name: foo" would also match the plain list item pattern
    const objItemMatch = line.match(/^\s{2,}-\s+([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/)
    if (objItemMatch && currentKey) {
      // Flush simple list if we switch to object list
      if (currentList) {
        result[currentKey] = currentList
        currentList = null
      }
      if (!currentObjList) {
        currentObjList = []
        currentObjListKey = currentKey
      }
      const obj: Record<string, unknown> = { [objItemMatch[1]]: objItemMatch[2].replace(/^["']|["']$/g, "") }
      currentObjList.push(obj)
      continue
    }

    // Plain list item under current key: "  - value"
    const listItemMatch = line.match(/^\s{2,}-\s+(.+)$/)
    if (listItemMatch && currentKey) {
      if (!currentList) currentList = []
      currentList.push(listItemMatch[1].replace(/^["']|["']$/g, ""))
      continue
    }

    // Nested key inside an object list item (e.g. "    description: foo")
    const nestedKvMatch = line.match(/^\s{4,}([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/)
    if (nestedKvMatch && currentObjList && currentObjList.length > 0) {
      const last = currentObjList[currentObjList.length - 1]
      last[nestedKvMatch[1]] = nestedKvMatch[2].replace(/^["']|["']$/g, "")
      continue
    }
  }

  // Flush remaining
  if (currentKey && currentList) {
    result[currentKey] = currentList
  }
  if (currentObjListKey && currentObjList) {
    result[currentObjListKey] = currentObjList
  }

  if (typeof result.name !== "string" || !result.name) return null
  if (typeof result.description !== "string" || !result.description) return null

  const manifest: SkillManifest = {
    name: result.name,
    description: result.description,
    path: filePath,
  }

  if (result.category) manifest.category = result.category as string
  if (Array.isArray(result.triggers)) manifest.triggers = result.triggers as string[]
  if (Array.isArray(result.parameters)) {
    manifest.parameters = (result.parameters as Record<string, unknown>[]).map(p => ({
      name: String(p.name ?? ""),
      description: String(p.description ?? ""),
      ...(p.default !== undefined ? { default: p.default } : {}),
    }))
  }

  return manifest
}

/**
 * Scan a plugin directory's skills subdirectories for SKILL.md files and return parsed manifests.
 */
async function loadSkillManifests(pluginDir: string): Promise<SkillManifest[]> {
  const skillsDir = join(pluginDir, "skills")
  const manifests: SkillManifest[] = []

  try {
    const skillDirs = await readdir(skillsDir, { withFileTypes: true })
    for (const entry of skillDirs) {
      if (!entry.isDirectory()) continue
      const skillMdPath = join(skillsDir, entry.name, "SKILL.md")
      try {
        const content = await readFile(skillMdPath, "utf-8")
        const manifest = parseSkillFrontmatter(content, skillMdPath)
        if (manifest) manifests.push(manifest)
      } catch {
        // SKILL.md doesn't exist or can't be read — skip
      }
    }
  } catch {
    // skills/ directory doesn't exist — fine
  }

  return manifests
}

/** Register a built-in plugin (survives loadPlugins reloads). */
export function registerPlugin(plugin: Plugin): void {
  registry.set(plugin.id, plugin)
  builtinIds.add(plugin.id)
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
  // Clear directory map (will be repopulated below)
  for (const id of pluginDirMap.keys()) {
    if (!builtinIds.has(id)) pluginDirMap.delete(id)
  }

  // Scan {workspace}/plugins/*/plugin.ts (new convention)
  const pluginsDir = join(workspacePath, "plugins")
  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dirPath = join(pluginsDir, entry.name)

      // Check if this directory has a .claude-plugin/
      const hasSkillsDir = await hasClaudePlugin(dirPath)

      let plugin: Plugin | undefined

      // Try to load plugin.ts / plugin.js
      for (const filename of ["plugin.ts", "plugin.js"]) {
        const fullPath = join(dirPath, filename)
        try {
          const mod = await importer(fullPath)
          plugin = mod.default
          break
        } catch (err: unknown) {
          // ENOENT = file doesn't exist, try next filename; other errors = broken plugin
          if ((err as NodeJS.ErrnoException).code === "ENOENT" ||
              (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") continue
          console.error(`plugin-loader: failed to load ${entry.name}/${filename}:`, err)
          break
        }
      }

      if (plugin) {
        // Data-source plugin (with or without skills)
        if (hasSkillsDir) {
          plugin.hasSkills = true
        }
        if (hasSkillsDir || isValidPlugin(plugin)) {
          if (hasSkillsDir) {
            plugin.skillManifest = await loadSkillManifests(dirPath)
            pluginDirMap.set(plugin.id, dirPath)
          }
          if (!isValidPlugin(plugin)) {
            console.warn(`plugin-loader: skipping ${entry.name} — missing id or query`)
            continue
          }
          if (!builtinIds.has(plugin.id)) {
            registry.set(plugin.id, plugin)
          }
          if (hasSkillsDir) {
            pluginDirMap.set(plugin.id, dirPath)
          }
        } else {
          console.warn(`plugin-loader: skipping ${entry.name} — missing id or query`)
        }
      } else if (hasSkillsDir) {
        // Skills-only plugin: no plugin.ts but has .claude-plugin/
        // Read plugin.json to get the name
        let pluginName = entry.name
        try {
          const manifestContent = await readFile(join(dirPath, ".claude-plugin", "plugin.json"), "utf-8")
          const manifest = JSON.parse(manifestContent) as Record<string, unknown>
          if (typeof manifest.name === "string" && manifest.name) {
            pluginName = manifest.name
          }
        } catch {
          // Use directory name as fallback
        }

        const skillsOnlyPlugin: Plugin = {
          id: entry.name,
          name: pluginName,
          icon: "Puzzle",
          hasSkills: true,
          skillManifest: await loadSkillManifests(dirPath),
        }
        if (!builtinIds.has(skillsOnlyPlugin.id)) {
          registry.set(skillsOnlyPlugin.id, skillsOnlyPlugin)
          pluginDirMap.set(skillsOnlyPlugin.id, dirPath)
        }
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
        const plugin = mod.default
        if (!isValidPlugin(plugin)) {
          console.warn(`plugin-loader: skipping ${file} — missing id or query`)
          continue
        }
        if (!targetRegistry.has(plugin.id) && !builtinIds.has(plugin.id)) {
          targetRegistry.set(plugin.id, plugin)
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

export function getPlugin(id: string, workspaceId?: string): Plugin | undefined {
  if (workspaceId) {
    const wsPlugin = workspacePluginRegistries.get(workspaceId)?.get(id)
    if (wsPlugin) return wsPlugin
  }
  return registry.get(id)
}

/**
 * Returns absolute paths of all plugin directories that have `.claude-plugin/`.
 * Used by session-manager to pass skill plugins into agent sessions.
 */
export function getSkillPluginPaths(): string[] {
  return [...pluginDirMap.values()]
}

/**
 * Returns the directory path for the plugin with the given id, if it has `.claude-plugin/`.
 */
export function getPluginDir(id: string): string | undefined {
  return pluginDirMap.get(id)
}

// Exposed for test isolation only — do not call in production
;(loadPlugins as unknown as Record<string, unknown>).__resetForTest = () => {
  registry.clear()
  builtinIds.clear()
  pluginDirMap.clear()
}
