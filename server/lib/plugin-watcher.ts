import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { loadPlugins } from "./plugin-loader.js"
import { mountPluginRoutes } from "../routes/plugins.js"
import type { Hono } from "hono"
import type { AppBindings } from "../lib/workspace-context.js"

interface Workspace {
  id: string
  path: string
}

const POLL_INTERVAL_MS = 1_000
const RELOAD_DEBOUNCE_MS = 500
const ENTRYPOINT_NAMES = ["plugin.ts", "plugin.js"] as const

const pollTimers = new Map<string, ReturnType<typeof setInterval>>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const snapshots = new Map<string, Map<string, string>>()
const scansInFlight = new Map<string, number>()
const reportedScanErrors = new Set<string>()
let watchGeneration = 0

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

async function readDirectory(path: string) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (error: unknown) {
    if (isMissingPath(error)) return []
    throw error
  }
}

async function entrypointSignature(path: string): Promise<string | undefined> {
  try {
    const entry = await stat(path)
    return entry.isFile() ? `${entry.mtimeMs}:${entry.size}` : undefined
  } catch (error: unknown) {
    if (isMissingPath(error)) return undefined
    throw error
  }
}

/**
 * Enumerate only paths the plugin loader can import. Workspace `plugins/`
 * trees also contain Studio assets, dependencies, logs, and runtime state;
 * recursively watching those trees exhausted file descriptors even though the
 * callback later ignored their events.
 */
async function discoverPluginEntrypoints(workspacePath: string): Promise<Map<string, string>> {
  const candidates: string[] = []

  for (const subdir of ["inbox", "plugins"] as const) {
    const root = join(workspacePath, subdir)
    const entries = await readDirectory(root)
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      for (const filename of ENTRYPOINT_NAMES) {
        candidates.push(join(root, entry.name, filename))
      }
    }
  }

  const legacyRoot = join(workspacePath, "inbox-plugins")
  for (const entry of await readDirectory(legacyRoot)) {
    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
      candidates.push(join(legacyRoot, entry.name))
    }
  }

  const next = new Map<string, string>()
  await Promise.all(candidates.map(async (path) => {
    const signature = await entrypointSignature(path)
    if (signature !== undefined) next.set(path, signature)
  }))
  return next
}

function snapshotsMatch(previous: Map<string, string>, next: Map<string, string>): boolean {
  if (previous.size !== next.size) return false
  for (const [path, signature] of previous) {
    if (next.get(path) !== signature) return false
  }
  return true
}

async function pollWorkspace(
  workspace: Workspace,
  app: Hono<AppBindings>,
  generation: number,
): Promise<void> {
  if (scansInFlight.has(workspace.id)) return
  scansInFlight.set(workspace.id, generation)
  try {
    const next = await discoverPluginEntrypoints(workspace.path)
    if (generation !== watchGeneration) return

    const previous = snapshots.get(workspace.id)
    snapshots.set(workspace.id, next)
    reportedScanErrors.delete(workspace.id)
    if (previous && !snapshotsMatch(previous, next)) scheduleReload(workspace, app)
  } catch (error: unknown) {
    if (generation !== watchGeneration || reportedScanErrors.has(workspace.id)) return
    reportedScanErrors.add(workspace.id)
    console.warn(
      `[plugin-watcher] Failed to scan plugin entrypoints for ${workspace.path}:`,
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    if (scansInFlight.get(workspace.id) === generation) scansInFlight.delete(workspace.id)
  }
}

/**
 * Poll the small set of loadable plugin entrypoints for source changes.
 * Polling avoids persistent recursive file watchers, which compete with tsx,
 * Vite, and other agent sessions for macOS file descriptors. A 500ms debounce
 * still coalesces changes before the plugin registry reloads.
 */
export function watchPlugins(workspaces: Workspace[], app: Hono<AppBindings>): void {
  stopWatching()
  const generation = watchGeneration

  for (const workspace of workspaces) {
    void pollWorkspace(workspace, app, generation)
    const timer = setInterval(() => {
      void pollWorkspace(workspace, app, generation)
    }, POLL_INTERVAL_MS)
    timer.unref()
    pollTimers.set(workspace.id, timer)
  }
}

function scheduleReload(workspace: Workspace, app: Hono<AppBindings>): void {
  clearTimeout(debounceTimers.get(workspace.id))
  debounceTimers.set(workspace.id, setTimeout(async () => {
    console.log(`[plugin-watcher] Reloading plugins for ${workspace.id}…`)
    try {
      await loadPlugins(workspace.path, workspace.id)
      mountPluginRoutes(app)
      console.log(`[plugin-watcher] Plugins reloaded for ${workspace.id}`)
    } catch (error: unknown) {
      console.error(`[plugin-watcher] Failed to reload plugins for ${workspace.id}:`, error)
    }
  }, RELOAD_DEBOUNCE_MS))
}

/** Stop polling and clear pending reloads for graceful shutdown or restart. */
export function stopWatching(): void {
  watchGeneration += 1
  for (const timer of pollTimers.values()) clearInterval(timer)
  pollTimers.clear()
  for (const timer of debounceTimers.values()) clearTimeout(timer)
  debounceTimers.clear()
  snapshots.clear()
  scansInFlight.clear()
  reportedScanErrors.clear()
}
