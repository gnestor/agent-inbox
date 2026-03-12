import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import type { WidgetDef, MutationContext } from "../../src/types/panels.js"

type MutationFn = (payload: unknown, ctx: MutationContext) => Promise<void>
type Importer = (path: string) => Promise<Record<string, MutationFn>>

const panelSchemas: Record<string, WidgetDef[]> = {}
const mutations: Record<string, MutationFn> = {}

/** Convert camelCase export name to kebab-case action name. */
function toKebab(name: string): string {
  return name.replace(/([A-Z])/g, "-$1").toLowerCase()
}

export async function loadPanels(
  workspacePath: string,
  importer: Importer = (p) => import(p)
): Promise<void> {
  // Clear existing state
  for (const key of Object.keys(panelSchemas)) delete panelSchemas[key]
  for (const key of Object.keys(mutations)) delete mutations[key]

  const workflowsDir = join(workspacePath, "workflows")

  let entries: string[]
  try {
    entries = await readdir(workflowsDir)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return
    throw err
  }

  for (const entry of entries) {
    const panelsPath = join(workflowsDir, entry, "inbox-panels.json")

    // Read panels.json
    let panelJson: string
    try {
      panelJson = await readFile(panelsPath, "utf8")
    } catch {
      continue
    }

    let schema: Record<string, WidgetDef[]>
    try {
      schema = JSON.parse(panelJson)
    } catch {
      console.warn(`panel-registry: invalid JSON in ${panelsPath}`)
      continue
    }

    // Register panels
    for (const [tag, widgets] of Object.entries(schema)) {
      panelSchemas[tag] = widgets
    }

    // Try to load mutations file — readFile to check existence, then importer
    const mutationsPath = join(workflowsDir, entry, "inbox-mutations.ts")
    try {
      await readFile(mutationsPath, "utf8")  // throws on ENOENT; undefined is fine
      const mod = await importer(mutationsPath)
      for (const [exportName, fn] of Object.entries(mod)) {
        if (typeof fn === "function") {
          mutations[toKebab(exportName)] = fn as MutationFn
        }
      }
    } catch {
      // mutations file doesn't exist or failed to load — skip
    }
  }
}

export function getPanelSchemas(): Record<string, WidgetDef[]> {
  return { ...panelSchemas }
}

export function getRegisteredTags(): string[] {
  return Object.keys(panelSchemas)
}

export async function executeMutation(
  action: string,
  payload: unknown,
  ctx: MutationContext
): Promise<void> {
  const handler = mutations[action]
  if (!handler) {
    throw new Error(`panel-registry: no handler registered for action "${action}"`)
  }
  await handler(payload, ctx)
}
