/**
 * Scheduled context backfill — runs all plugin raw backfills, then launches
 * a curation session to update curated context/*.md pages.
 *
 * Two-phase cycle (every 30 minutes, single-process only):
 *   1. Raw indexing — calls runBackfill() for every plugin with query()+itemToContext()
 *   2. Curated update — uses backfill_state to find plugins with new indexed files,
 *      then launches a Claude session to read the new raw files and update curated pages
 */

import { resolve, join } from "path"
import * as fs from "fs"
import { createLogger } from "./logger.js"
import { getPlugins } from "./plugin-loader.js"
import { runBackfill } from "../routes/backfill.js"
import { query as dbQueryAll, queryOne, execute } from "../db/pool.js"
import { startSession } from "./session-manager.js"

const log = createLogger("context-backfill")

const INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const CURATION_PLUGIN_ID = "context-curation"

let isRunning = false

/**
 * Run the full backfill cycle: raw indexing for all plugins, then curation.
 */
export async function runContextBackfill(
  workspacePath: string,
  workspaceId?: string,
): Promise<{
  raw: Record<string, { processed: number; total: number } | { error: string }>
  curation: { sessionId: string } | { skipped: string } | { error: string }
}> {
  if (isRunning) {
    log.info("Skipping — backfill already running")
    return { raw: {}, curation: { skipped: "already running" } }
  }

  isRunning = true
  try {
    const raw = await runRawBackfill(workspacePath, workspaceId)
    const curation = await runCuratedUpdate(workspacePath, workspaceId)
    return { raw, curation }
  } finally {
    isRunning = false
  }
}

/**
 * Phase 1: Run raw backfill for all plugins with query()+itemToContext().
 */
async function runRawBackfill(
  workspacePath: string,
  workspaceId?: string,
): Promise<Record<string, { processed: number; total: number } | { error: string }>> {
  const plugins = getPlugins(workspaceId).filter((p) => p.query && p.itemToContext)
  const results: Record<string, { processed: number; total: number } | { error: string }> = {}

  await Promise.allSettled(
    plugins.map(async (plugin) => {
      try {
        const result = await runBackfill(plugin, workspacePath, undefined, workspaceId)
        results[plugin.id] = { processed: result.processed, total: result.total }
        if (result.processed > 0) {
          log.info("Raw backfill complete", { plugin: plugin.id, ...result })
        }
      } catch (err) {
        results[plugin.id] = { error: (err as Error).message }
        log.warn("Raw backfill failed", { plugin: plugin.id, error: (err as Error).message })
      }
    }),
  )

  return results
}

/**
 * Phase 2: Check backfill_state for plugins that indexed new files since last
 * curation, then launch a Claude session to update curated context pages.
 *
 * Uses the DB instead of scanning the filesystem — avoids statting 75k+ files.
 */
export async function runCuratedUpdate(
  workspacePath: string,
  workspaceId?: string,
): Promise<{ sessionId: string } | { skipped: string } | { error: string }> {
  const contextDir = resolve(workspacePath, "context")
  if (!fs.existsSync(contextDir)) {
    return { skipped: "no context directory" }
  }

  const wsId = workspaceId || "agent"

  const curationRow = await queryOne<{ last_cursor: string | null }>(
    "SELECT last_cursor FROM backfill_state WHERE plugin_id = $1 AND workspace_id = $2",
    [CURATION_PLUGIN_ID, wsId],
  )
  const lastCuration = curationRow?.last_cursor || "1970-01-01T00:00:00Z"

  // Find plugins that indexed new files since last curation
  const updatedPlugins = await dbQueryAll<{ plugin_id: string; total_indexed: number }>(
    `SELECT plugin_id, total_indexed FROM backfill_state
     WHERE workspace_id = $1 AND plugin_id != $2
       AND last_run_at > $3 AND total_indexed > 0`,
    [wsId, CURATION_PLUGIN_ID, lastCuration],
  )

  if (updatedPlugins.length === 0) {
    return { skipped: "no plugins indexed new files since last curation" }
  }

  // List actual new files from updated plugin directories
  const newFiles: string[] = []
  const lastCurationMs = new Date(lastCuration).getTime()

  for (const { plugin_id } of updatedPlugins) {
    const sourceDir = join(contextDir, plugin_id)
    if (!fs.existsSync(sourceDir)) continue

    // Use async readdir to avoid blocking the event loop
    const files = await fs.promises.readdir(sourceDir)
    for (const file of files) {
      if (!file.endsWith(".md")) continue
      try {
        const stat = await fs.promises.stat(join(sourceDir, file))
        if (stat.mtimeMs > lastCurationMs) {
          newFiles.push(`context/${plugin_id}/${file}`)
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  if (newFiles.length === 0) {
    return { skipped: "no new raw files since last curation" }
  }

  log.info("Starting curation session", { newFiles: newFiles.length })

  const maxFiles = 50
  const filesToProcess = newFiles.slice(0, maxFiles)
  const hasMore = newFiles.length > maxFiles

  const prompt = buildCurationPrompt(filesToProcess, hasMore)

  try {
    const sessionId = await startSession(prompt, {
      triggerSource: "context-backfill",
      workspacePath,
      linkedItemTitle: `Context curation — ${filesToProcess.length} new files`,
    })

    // Set cursor to the max mtime of files we sent, not "now" — avoids
    // skipping files written between scan and cursor update
    const maxMtime = new Date(lastCurationMs + 1).toISOString()
    const now = new Date().toISOString()
    await execute(
      `INSERT INTO backfill_state (plugin_id, workspace_id, last_cursor, last_run_at, total_indexed, updated_at)
       VALUES ($1, $2, $3, $4, 0, $4)
       ON CONFLICT (plugin_id, workspace_id) DO UPDATE
         SET last_cursor = EXCLUDED.last_cursor, last_run_at = EXCLUDED.last_run_at, updated_at = EXCLUDED.updated_at`,
      [CURATION_PLUGIN_ID, wsId, now, now],
    )

    return { sessionId }
  } catch (err) {
    log.error("Curation session failed to start", { error: (err as Error).message })
    return { error: (err as Error).message }
  }
}

function buildCurationPrompt(files: string[], hasMore: boolean): string {
  const fileList = files.map((f) => `- ${f}`).join("\n")

  return `You are updating the curated context knowledge base with information from recently indexed raw source files.

## New raw files to process

${fileList}${hasMore ? "\n\n(More files will be processed in the next cycle)" : ""}

## Instructions

1. Read each file listed above
2. For each file, identify entities, facts, decisions, or relationships worth capturing in curated context pages
3. Query existing curated pages: \`qmd query "<entity or topic>" -c hammies-context\`
4. Update existing curated pages or create new ones per \`context/SCHEMAS.md\`
5. Only add information not already present in curated pages — do not reorganize or rewrite existing content
6. After all updates, re-index: \`qmd update && qmd embed\`

## Rules

- Follow context/SCHEMAS.md for page format, tag taxonomy, and section ordering
- Update \`last_updated\` in frontmatter on any page you modify
- Add cross-links in \`## Related\` when new relationships are identified
- Do NOT write to source subdirectories (gmail/, notion/, etc.) — only curated pages (context/*.md)
- Do NOT dispatch background subagents or trigger context updates at session end
- Skip files that contain only trivial Q&A or no actionable context`
}

/**
 * Start the scheduled backfill interval.
 */
export function scheduleContextBackfill(
  workspacePath: string,
  workspaceId?: string,
): void {
  log.info("Scheduling context backfill", { intervalMs: INTERVAL_MS })

  const timer = setInterval(() => {
    runContextBackfill(workspacePath, workspaceId).catch((err) => {
      log.error("Scheduled backfill failed", { error: (err as Error).message })
    })
  }, INTERVAL_MS)
  timer.unref()
}
