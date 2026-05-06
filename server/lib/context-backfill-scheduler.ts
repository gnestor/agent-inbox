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
import { runBackgroundCurationSession, cleanupStaleCurationLocks } from "./curation-session.js"

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

  // Cursor keys: separate per source so they advance independently. The
  // pending row is managed by runBackgroundCurationSession.
  const cursorKey = `${CURATION_PLUGIN_ID}:${sourceFilter}`
  const pendingKey = `${cursorKey}:pending`

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

  // Paths in the batch are workspace-relative (e.g. "context/gmail/abc.md"
  // or "backfill-cache/google-drive/abc.md"). The curation CWD is
  // {workspace}/context, so strip the context/ prefix for files inside it
  // and prefix "../" for files outside it.
  const filePaths = batch.map((f) => (
    f.path.startsWith("context/")
      ? f.path.slice("context/".length)
      : `../${f.path}`
  ))
  if (!plugin.curationPrompt) {
    return { skipped: `plugin ${sourceFilter} has no curationPrompt` }
  }
  const prompt = plugin.curationPrompt(filePaths)
  if (!prompt) {
    return { skipped: `curation skipped for ${sourceFilter}` }
  }

  const result = await runBackgroundCurationSession({
    workspacePath,
    workspaceId: wsId,
    pendingKey,
    prompt,
    linkedItemTitle: `Context curation — ${batch.length} files (${remaining} remaining)`,
    onComplete: async () => {
      const completedAt = new Date().toISOString()
      await execute(
        `INSERT INTO backfill_state (plugin_id, workspace_id, last_cursor, last_run_at, total_indexed, updated_at)
         VALUES ($1, $2, $3, $4, 0, $4)
         ON CONFLICT (plugin_id, workspace_id) DO UPDATE
           SET last_cursor = EXCLUDED.last_cursor,
               last_run_at = EXCLUDED.last_run_at,
               updated_at = EXCLUDED.updated_at`,
        [cursorKey, wsId, String(maxMtimeMs), completedAt],
      )
      log.info("Advanced curation cursor", { source: sourceFilter, cursor: maxMtimeMs })
    },
  })

  if ("sessionId" in result) {
    return { sessionId: result.sessionId, remaining }
  }
  return result
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

Your working directory is the \`context/\` folder — all paths below are relative to it.

## A context page IS
- An index of an entity's identity, attributes, and dense links to other entities and sources
- Where to find the details — not where the details live

## A context page IS NOT
- A restatement or summary of source files (link them in \`## Timeline\` and \`## Sources\`)
- A copy of transactional data (orders, invoices, inventory lists) — mention existence, link canonical source
- A standalone read — summaries are generated on-demand from linked sources in a specific session's context

## Eligibility — when an entity page should exist

An entity page requires **both**:

1. **Two-way exchange** — at least one inbound message (from the entity) AND at least one outbound message (from Hammies/Grant/staff). A single direction is not enough on its own.
2. **Affirmative outcome** — Hammies took a positive action toward the relationship. Examples:
   - Accepted a collaboration, partnership, or proposal
   - Approved a wholesale application
   - Placed or fulfilled an order
   - Signed a contract or onboarded a vendor
   - Invited the contact into a Hammies tool/team (e.g. Figma, Slack, Klaviyo)
   - Engaged on a sustained follow-up (multiple back-and-forth threads, scheduled call attended)

Do **not** create a page when:
- Hammies declined the offer/proposal/request, OR replied politely and let it die.
- The thread ends with us saying no, ghosting, or unresolved "we'll think about it" with no follow-through.
- Only outbound messages exist (cold pitches we sent, courtesy notices, dispute notifications with no reply).
- Only inbound messages exist (cold outreach we ignored, broadcast list inclusions, applications we never replied to).
- The Gorgias stub is empty (no message body) regardless of how many tickets exist.
- The entity is mentioned only in our internal notes and we never communicated with them.

## Group contacts under their organization

When a person's primary association is with a company that has (or qualifies for) its own page, **do not create a separate person page**. Capture the person's name, role, email, and any timeline events on the company's page instead. Examples:
- Ryder Chosewood (buyer at Kempt Athens) → all info lives on \`kempt-athens.md\`, not a separate \`ryder-chosewood.md\`
- Tam Myers (buyer at ban.do) → \`bando-com.md\` (or whatever the company page is named)
- A contact at Distribution Management → on \`distribution-management.md\`

Person pages are only justified for:
- Independent individuals not tied to a company we curate (freelance contractors, friends, advisors)
- Hammies team members
- People whose relationship to Hammies is independent of any single company (e.g. someone who has worked across multiple vendors)

If a session is dispatched for \`person:<email>\` whose domain has a company page, treat it as a no-op: mark sources processed and skip page creation. Add the person's contact info to the company page if it isn't already there.

See also \`REP_AGGREGATION_DOMAINS\` in \`packages/agent/plugins/workspace-filters.ts\` — domains where the extractor already suppresses person entities up front.

If you encounter sources for an ineligible entity, mark its sources processed (so they don't requeue) but do not create or maintain a page. Don't create empty placeholder pages.

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

Flat format (relative to \`context/\`):
- Curated page: \`[Title](filename.md)\`
- Gmail source: \`[Subject](gmail/threadId.md)\`
- Gorgias source: \`[Ticket #id](gorgias/ticketId.md)\`
- Session source: \`[Summary](sessions/sessionId.md)\`
- Drive source: \`[Filename](../backfill-cache/google-drive/fileId.md)\`
- Notion source: \`[Title](notion-tasks/pageId.md)\`

When A → B, also link B → A.

## Process

1. Read \`INDEX.md\` to find existing pages.
2. **Read \`SCHEMAS.md\`** and locate the section matching this entity's type (Department, Person, Company/Vendor, Wholesale Customer, Project, Product, Purchase Order, Marketing Event, Technical Reference, Session Log). The schema specifies required sections, required Sources items, naming conventions, and entity-specific extras.
3. For each source file, update an existing page or create a new one consistent with the matching schema.
4. **Schema drift audit (existing pages only)**: when you open an existing page, also compare its structure against the matching schema in SCHEMAS.md. If the schema requires a section or a Sources item the page is missing, add it now — even if the current source file you're processing wouldn't otherwise have prompted that change. Examples: a wholesale-customer page that lacks the Shopify customer URL or the Notion Stockists link should get them added on the next touch. Do **not** restructure or rewrite valid existing content; only fill gaps required by the schema.
5. Use the **brand/business name** as the page slug, not the domain (e.g. \`celeste-store.md\` not \`celestestore-be.md\`). The slug-from-domain default is only for unknown/anonymous entities; rename when the entity is identified.
6. Only add information not already present — do not rewrite existing content. (The schema-drift audit in step 4 is the only exception, and it adds rather than rewrites.)
7. Append each change to \`LOG.md\`: \`| YYYY-MM-DD | created/updated | filename.md | one-line summary |\`. Note schema-audit-only changes as \`updated (schema drift)\` so the source of the change is visible.
8. Run \`qmd update && qmd embed\`.

## Source-specific guidance for ${source}

${guide}

## Files to process (${files.length})

${fileList}

## Rules
- Only write to curated pages (\`*.md\` at the top level) and \`INDEX.md\` / \`LOG.md\`
- Update \`last_updated\` on any page you modify
- Do NOT dispatch background subagents`
}

/** Sweep interval for orphaned curation locks. */
const STALE_LOCK_SWEEP_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Start the scheduled backfill interval and the stale-lock sweeper.
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

  // Periodically clear orphaned `entity-curation:*:pending` rows so a
  // crashed/aborted session can't pin its entity forever. The dispatch
  // path also handles staleness on re-attempt, but entities nobody
  // re-tries would otherwise sit forever.
  const lockSweep = setInterval(() => {
    cleanupStaleCurationLocks()
      .then((cleared) => {
        if (cleared > 0) log.info("Cleared stale curation locks", { count: cleared })
      })
      .catch((err) => log.error("Stale lock sweep failed", { error: (err as Error).message }))
  }, STALE_LOCK_SWEEP_MS)
  lockSweep.unref()
}
