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
import { queryOne, execute } from "../db/pool.js"
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
  curation: Record<string, { sessionId: string } | { skipped: string } | { error: string }>
}> {
  if (isRunning) {
    log.info("Skipping — backfill already running")
    return { raw: {}, curation: {} }
  }

  isRunning = true
  try {
    const raw = await runRawBackfill(workspacePath, workspaceId)

    // Phase 2 (per-source curation) is DISABLED. The new entity-curation flow
    // (entity-curator.ts) replaces it, driven externally by a bash loop calling
    // /api/backfill/curate-entity/next. Leaving per-source curation on here
    // would compete with that driver and double-dispatch sessions.
    const curation: Record<string, { skipped: string }> = {}

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

interface FileEntry {
  path: string      // relative: context/{source}/{file}
  mtimeMs: number
}

/**
 * Phase 2: Find raw source files modified since the last curation cursor,
 * sorted chronologically (oldest first), and launch a Claude session to
 * update curated context pages.
 *
 * Cursor is the mtime (ms) of the last file processed. Files updated after
 * processing get a newer mtime and will be re-curated on the next run.
 * Call repeatedly to process all files in batches.
 */
export async function runCuratedUpdate(
  workspacePath: string,
  workspaceId?: string,
  sourceFilter?: string,
): Promise<{ sessionId: string; remaining: number } | { skipped: string } | { error: string }> {
  const contextDir = resolve(workspacePath, "context")
  if (!fs.existsSync(contextDir)) {
    return { skipped: "no context directory" }
  }

  const wsId = workspaceId || "agent"

  // Curation is always per-source. A single session processes files from one
  // source type so it can specialize (shared context, source-specific prompt).
  if (!sourceFilter) {
    return { error: "source filter is required — call /api/backfill/curate?source={pluginId}" }
  }

  const plugins = getPlugins(workspaceId)
  const plugin = plugins.find((p) => p.id === sourceFilter)
  if (!plugin) {
    return { error: `unknown source '${sourceFilter}'` }
  }

  // Cursor keys: separate per source so they advance independently.
  // The :pending row tracks in-flight sessions — its cursor stores "sessionId|maxMtimeMs".
  const cursorKey = `${CURATION_PLUGIN_ID}:${sourceFilter}`
  const pendingKey = `${cursorKey}:pending`

  // Reconcile any in-flight session from the previous call
  const pendingRow = await queryOne<{ last_cursor: string | null }>(
    "SELECT last_cursor FROM backfill_state WHERE plugin_id = $1 AND workspace_id = $2",
    [pendingKey, wsId],
  )

  if (pendingRow?.last_cursor) {
    const [pendingSessionId, pendingMtime] = pendingRow.last_cursor.split("|")
    const session = await queryOne<{ status: string }>(
      "SELECT status FROM sessions WHERE id = $1",
      [pendingSessionId],
    )

    if (session?.status === "running" || session?.status === "awaiting_user_input") {
      return { skipped: `previous curation session ${pendingSessionId} still ${session.status}` }
    }

    if (session?.status === "complete" || session?.status === "archived") {
      // Previous session finished — advance the real cursor
      const now = new Date().toISOString()
      await execute(
        `INSERT INTO backfill_state (plugin_id, workspace_id, last_cursor, last_run_at, total_indexed, updated_at)
         VALUES ($1, $2, $3, $4, 0, $4)
         ON CONFLICT (plugin_id, workspace_id) DO UPDATE
           SET last_cursor = EXCLUDED.last_cursor,
               last_run_at = EXCLUDED.last_run_at,
               updated_at = EXCLUDED.updated_at`,
        [cursorKey, wsId, pendingMtime, now],
      )
      log.info("Advanced curation cursor", { sessionId: pendingSessionId, cursor: pendingMtime })
    } else {
      // errored, missing, or unknown — discard pending and retry the same range
      log.warn("Previous curation session did not complete cleanly, retrying range", {
        sessionId: pendingSessionId,
        status: session?.status ?? "missing",
      })
    }

    await execute(
      "DELETE FROM backfill_state WHERE plugin_id = $1 AND workspace_id = $2",
      [pendingKey, wsId],
    )
  }

  const curationRow = await queryOne<{ last_cursor: string | null }>(
    "SELECT last_cursor FROM backfill_state WHERE plugin_id = $1 AND workspace_id = $2",
    [cursorKey, wsId],
  )
  const cursorMs = curationRow?.last_cursor ? Number(curationRow.last_cursor) : 0

  // Resolve the plugin's source directory
  const pluginDir = plugin.backfillDir
    ? resolve(workspacePath, plugin.backfillDir)
    : join(contextDir, plugin.id)
  const relPath = plugin.backfillDir ?? `context/${plugin.id}`

  if (!fs.existsSync(pluginDir)) {
    return { skipped: `no source directory for ${sourceFilter}` }
  }

  // Scan source dir for files with mtime > cursor, sorted chronologically
  const pending: FileEntry[] = []
  const files = await fs.promises.readdir(pluginDir)
  for (const file of files) {
    if (!file.endsWith(".md")) continue
    try {
      const stat = await fs.promises.stat(join(pluginDir, file))
      if (stat.mtimeMs > cursorMs) {
        pending.push({ path: `${relPath}/${file}`, mtimeMs: stat.mtimeMs })
      }
    } catch {
      // Skip unreadable files
    }
  }

  if (pending.length === 0) {
    return { skipped: "no files to curate" }
  }

  pending.sort((a, b) => a.mtimeMs - b.mtimeMs)

  // Pack files into a token-budgeted batch. Default: 500K tokens per session.
  // Rough estimate: 1 token ≈ 4 chars, so budget ~2MB of file content.
  const tokenBudget = plugin.curationBatchTokens ?? 500_000
  const charBudget = tokenBudget * 4
  const batch: FileEntry[] = []
  let charCount = 0
  for (const f of pending) {
    if (batch.length > 0 && charCount >= charBudget) break
    try {
      const stat = await fs.promises.stat(join(workspacePath, f.path))
      batch.push(f)
      charCount += stat.size
    } catch {
      // Skip
    }
  }

  const remaining = pending.length - batch.length
  const maxMtimeMs = batch[batch.length - 1]!.mtimeMs

  log.info("Starting curation session", {
    source: sourceFilter,
    batch: batch.length,
    chars: charCount,
    estTokens: Math.round(charCount / 4),
    remaining,
  })

  // Build the prompt via the plugin's curationPrompt method
  const filePaths = batch.map((f) => f.path)
  if (!plugin.curationPrompt) {
    return { skipped: `plugin ${sourceFilter} has no curationPrompt` }
  }
  const prompt = plugin.curationPrompt(filePaths)
  if (!prompt) {
    return { skipped: `curation skipped for ${sourceFilter}` }
  }

  try {
    const sessionId = await startSession(prompt, {
      triggerSource: "context-backfill",
      workspacePath,
      linkedItemTitle: `Context curation — ${batch.length} files (${remaining} remaining)`,
    })

    // Store pending state — the next call will advance the real cursor only if
    // this session completes successfully.
    const now = new Date().toISOString()
    await execute(
      `INSERT INTO backfill_state (plugin_id, workspace_id, last_cursor, last_run_at, total_indexed, updated_at)
       VALUES ($1, $2, $3, $4, $5, $4)
       ON CONFLICT (plugin_id, workspace_id) DO UPDATE
         SET last_cursor = EXCLUDED.last_cursor,
             last_run_at = EXCLUDED.last_run_at,
             total_indexed = backfill_state.total_indexed + EXCLUDED.total_indexed,
             updated_at = EXCLUDED.updated_at`,
      [pendingKey, wsId, `${sessionId}|${maxMtimeMs}`, now, batch.length],
    )

    return { sessionId, remaining }
  } catch (err) {
    log.error("Curation session failed to start", { error: (err as Error).message })
    return { error: (err as Error).message }
  }
}

/**
 * Default curation prompt for plugins that update the global context knowledge
 * base. Plugins call this from their `curationPrompt(files)` method and pass
 * a source-specific guide describing what to extract.
 *
 * Exported so plugins can import and reuse: plugins that need a different flow
 * (e.g., scoped output, no global cross-referencing) can return their own
 * prompt instead.
 */
export function buildDefaultCurationPrompt(
  source: string,
  files: string[],
  guide: string,
): string {
  const fileList = files.map((f) => `- ${f}`).join("\n")

  return `You are maintaining Hammies' relationship index by curating ${source} source files.

## A context page IS
- An index of an entity's identity, attributes, and dense links to other entities and sources
- Where to find the details — not where the details live

## A context page IS NOT
- A restatement or summary of source files (link them in \`## Timeline\` and \`## Sources\`)
- A copy of transactional data (orders, invoices, inventory lists) — mention existence, link canonical source
- A standalone read — summaries are generated on-demand from linked sources in a specific session's context

## Structure
- Frontmatter: \`tags\`, \`last_updated\`
- One-sentence identity line
- \`## Details\` — key attributes
- \`## Timeline\` — dated milestones, each linking to the source file that recorded it
- \`## Sources\` — raw source files that contributed
- \`## Related\` — other curated pages with one-line relationships

## Linking (critical)

Use dense inline links throughout prose, not just in Sources/Related:
- "[Grant](grant-nestor.md) hired [Kurt Koenig](kurt-koenig.md) for the [Levi's lawsuit](levi-lawsuit.md)"

Flat format from \`context/\`:
- Curated page: \`[Title](filename.md)\`
- Gmail source: \`[Subject](gmail/threadId.md)\`
- Gorgias source: \`[Ticket #id](gorgias/ticketId.md)\`
- Session source: \`[Summary](sessions/sessionId.md)\`
- Drive source: \`[Filename](../backfill-cache/google-drive/fileId.md)\`
- Notion source: \`[Title](notion-tasks/pageId.md)\`

When A → B, also link B → A.

## Process

1. Read \`context/INDEX.md\` to find existing pages.
2. For each source file, update existing pages or create new ones (per \`context/SCHEMAS.md\`).
3. Only add information not already present — do not rewrite existing content.
4. Append each change to \`context/LOG.md\`: \`| YYYY-MM-DD | created/updated | filename.md | one-line summary |\`
5. Run \`qmd update && qmd embed\`.

## Source-specific guidance for ${source}

${guide}

## Files to process (${files.length})

${fileList}

## Rules
- Only write to curated pages (\`context/*.md\`) and \`context/INDEX.md\` / \`context/LOG.md\`
- Update \`last_updated\` on any page you modify
- Do NOT dispatch background subagents`
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
