/**
 * Entity curation — one Claude session per entity.
 *
 * Given an entity (type + value), gather all unprocessed sources that mention
 * it, locate the candidate curated context page (via tiered lookup), and
 * dispatch a tightly-scoped session that updates or creates the page, discovers
 * new entities, and leaves links behind. Pending-session lock prevents
 * concurrent runs for the same entity.
 */

import { readFile } from "fs/promises"
import { join, resolve } from "path"
import { spawnSync } from "child_process"
import { createLogger } from "./logger.js"
import { queryOne, execute } from "../db/pool.js"
import { startSession } from "./session-manager.js"
import {
  canonicalize,
  topUnprocessedEntities,
  unprocessedSourcesForEntity,
  markProcessed,
  insertDiscoveredEntities,
} from "./entity-extractor.js"
import type { Entity } from "../../src/types/plugin.js"

const log = createLogger("entity-curator")

const CURATOR_KEY_PREFIX = "entity-curation"

type CurateResult =
  | { sessionId: string; entity: { type: string; value: string }; sources: number; candidate: string | null }
  | { skipped: string }
  | { error: string }

/**
 * Derive a filename slug from an entity value.
 * - emails → local-part-domain-tld
 * - names → lowercase-hyphens
 */
function entityToSlug(type: string, value: string): string {
  if (type === "person" && value.includes("@")) {
    const [local, domain] = value.split("@")
    return `${local}-${(domain ?? "").replace(/\./g, "-")}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-")
  }
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/**
 * Tiered candidate-page lookup:
 *  1. Canonical slug → context/<slug>.md
 *  2. ripgrep literal match
 *  3. qmd query (local Qwen expansion, no Claude)
 */
async function findCandidatePage(
  contextDir: string,
  entityType: string,
  entityValue: string,
): Promise<string | null> {
  const slug = entityToSlug(entityType, entityValue)

  // 1. Direct slug match
  const slugPath = join(contextDir, `${slug}.md`)
  try {
    await readFile(slugPath, "utf8")
    return `context/${slug}.md`
  } catch { /* not found */ }

  // 2. ripgrep literal
  const rg = spawnSync("rg", ["-l", "--glob", "*.md", "-F", entityValue, contextDir], { encoding: "utf8" })
  if (rg.status === 0 && rg.stdout.trim()) {
    const lines = rg.stdout.trim().split("\n")
    // Prefer files with slug in the name
    const preferred = lines.find((p) => p.toLowerCase().includes(slug))
    const pick = preferred ?? lines[0]!
    return pick.startsWith(contextDir) ? `context/${pick.slice(contextDir.length).replace(/^\/+/, "")}` : pick
  }

  // 3. qmd query (expansion + rerank, local models)
  const qmd = spawnSync("qmd", ["query", entityValue, "-c", "context", "--files", "-n", "3"], { encoding: "utf8" })
  if (qmd.status === 0 && qmd.stdout.trim()) {
    const line = qmd.stdout.trim().split("\n")[0]!
    // qmd prints paths like "qmd://context/foo.md"
    const m = line.match(/qmd:\/\/context\/(\S+\.md)/)
    if (m) return `context/${m[1]}`
  }

  return null
}

/** Parse <new-entities> block from agent output. */
export function parseDiscoveredEntities(text: string): Entity[] {
  const match = text.match(/<new-entities>([\s\S]*?)<\/new-entities>/)
  if (!match) return []
  const entities: Entity[] = []
  for (const line of match[1]!.split("\n")) {
    const m = line.trim().match(/^([a-z_-]+)\s*:\s*(.+?)(?:\s*#.*)?$/)
    if (!m) continue
    const type = m[1]!
    const value = canonicalize(type, m[2]!)
    if (value) entities.push({ type, value })
  }
  return entities
}

function buildEntityPrompt(
  entityType: string,
  entityValue: string,
  candidatePath: string | null,
  candidateContent: string | null,
  sourcePaths: string[],
): string {
  const sourceList = sourcePaths.map((p) => `- ${p}`).join("\n")
  const candidateSection = candidatePath && candidateContent
    ? `## Existing page — update it\n\nPath: \`${candidatePath}\`\n\n\`\`\`markdown\n${candidateContent}\n\`\`\``
    : `## No existing page\n\nCreate a new page for this entity. Use canonical slug \`${entityToSlug(entityType, entityValue)}.md\` unless \`context/INDEX.md\` suggests a better name.`

  return `You are maintaining a single entity's page in Hammies' relationship index.

## Entity
- **Type:** ${entityType}
- **Value:** ${entityValue}

## A context page IS
- An index of identity, attributes, and dense links to other entities and sources
- Where to find the details — not where the details live

## A context page IS NOT
- A restatement or summary of source files (link them in \`## Timeline\` and \`## Sources\`)
- A copy of transactional data (orders, invoices, inventory) — link canonical sources instead
- A standalone read — summaries are generated on-demand from linked sources

## Structure
- Frontmatter (\`tags\`, \`last_updated\`)
- One-sentence identity line
- \`## Details\` — key attributes
- \`## Timeline\` — dated milestones, each linking to the source file that recorded it
- \`## Sources\` — raw source files that contributed
- \`## Related\` — other curated pages with one-line relationships

## Linking
- Use dense inline links throughout prose, not just in Sources/Related
- Flat format from \`context/\`: \`[Title](filename.md)\` for curated pages, \`[Subject](gmail/id.md)\` for sources, \`[File](../backfill-cache/google-drive/id.md)\` for Drive
- When A → B, also link B → A

## Entity discovery
Whenever you see a person, company, product, project, or other curatable entity mentioned in the sources that doesn't already have a page, queue it for curation by including it in your response as:

<new-entities>
entity_type: canonical_value
...
</new-entities>

Use the same entity types (person, company, product, project, folder, channel, tag, etc.). Do not emit entities for the one you're currently curating.

${candidateSection}

## Sources to process (${sourcePaths.length})

Read the source files you need. You don't need to read all of them — only those that reveal attributes, timeline events, or relationships worth capturing. Cite every source whose content you used.

${sourceList}

## Output
Make the minimum edits needed: add inline links, timeline entries, sources, and related pages. Don't rewrite existing content. Update \`last_updated\` in frontmatter.

After editing, append a line to \`context/LOG.md\`:
\`| YYYY-MM-DD | created/updated | filename.md | one-line summary |\`

End your response with the \`<new-entities>\` block (empty if none discovered).

Do NOT dispatch background subagents.`
}

/**
 * Run an entity curation session. Pending-row lock prevents concurrent runs.
 * Cursor key for pending: "entity-curation:<type>:<value>:pending" with value "sessionId|sources-json".
 */
export async function curateEntity(
  workspacePath: string,
  entityType: string,
  entityValue: string,
  workspaceId?: string,
): Promise<CurateResult> {
  const wsId = workspaceId || "agent"
  const cursorKey = `${CURATOR_KEY_PREFIX}:${entityType}:${entityValue}`
  const pendingKey = `${cursorKey}:pending`

  // Reconcile any in-flight session
  const pendingRow = await queryOne<{ last_cursor: string | null }>(
    "SELECT last_cursor FROM backfill_state WHERE plugin_id = $1 AND workspace_id = $2",
    [pendingKey, wsId],
  )

  if (pendingRow?.last_cursor) {
    const sepIdx = pendingRow.last_cursor.indexOf("|")
    const pendingSessionId = sepIdx >= 0 ? pendingRow.last_cursor.slice(0, sepIdx) : pendingRow.last_cursor
    const encodedSources = sepIdx >= 0 ? pendingRow.last_cursor.slice(sepIdx + 1) : "[]"

    const session = await queryOne<{ status: string }>(
      "SELECT status FROM sessions WHERE id = $1",
      [pendingSessionId],
    )

    if (session?.status === "running" || session?.status === "awaiting_user_input") {
      return { skipped: `previous entity curation session ${pendingSessionId} still ${session.status}` }
    }

    if (session?.status === "complete" || session?.status === "archived") {
      // Previous session finished — mark its sources as processed for this entity
      let processedSources: string[] = []
      try {
        processedSources = JSON.parse(encodedSources)
      } catch { /* ignore */ }
      if (processedSources.length > 0) {
        await markProcessed(wsId, entityType, entityValue, processedSources)
      }

      // Parse new entities from the session's transcript (best-effort — if the
      // agent emitted them as a <new-entities> block in its final message).
      // We don't have direct access to transcript text here without loading the
      // JSONL; skip for now and rely on the curation agent's own file writes.
      log.info("Advanced entity curation", {
        sessionId: pendingSessionId,
        entity: `${entityType}:${entityValue}`,
        sources: processedSources.length,
      })
    } else {
      log.warn("Previous entity curation did not complete cleanly, retrying", {
        sessionId: pendingSessionId,
        status: session?.status ?? "missing",
      })
    }

    await execute(
      "DELETE FROM backfill_state WHERE plugin_id = $1 AND workspace_id = $2",
      [pendingKey, wsId],
    )
  }

  // Gather unprocessed sources for this entity
  const sources = await unprocessedSourcesForEntity(wsId, entityType, entityValue)
  if (sources.length === 0) {
    return { skipped: `no unprocessed sources for ${entityType}:${entityValue}` }
  }

  // Find candidate page
  const contextDir = resolve(workspacePath, "context")
  const candidatePath = await findCandidatePage(contextDir, entityType, entityValue)
  let candidateContent: string | null = null
  if (candidatePath) {
    try {
      candidateContent = await readFile(resolve(workspacePath, candidatePath), "utf8")
    } catch {
      candidateContent = null
    }
  }

  const prompt = buildEntityPrompt(entityType, entityValue, candidatePath, candidateContent, sources)

  try {
    const sessionId = await startSession(prompt, {
      triggerSource: "context-backfill",
      workspacePath,
      linkedItemTitle: `Entity curation — ${entityType}: ${entityValue} (${sources.length} sources)`,
    })

    const now = new Date().toISOString()
    // Encode sources into the pending cursor so the next call can mark them processed
    const cursorValue = `${sessionId}|${JSON.stringify(sources)}`
    await execute(
      `INSERT INTO backfill_state (plugin_id, workspace_id, last_cursor, last_run_at, total_indexed, updated_at)
       VALUES ($1, $2, $3, $4, $5, $4)
       ON CONFLICT (plugin_id, workspace_id) DO UPDATE
         SET last_cursor = EXCLUDED.last_cursor,
             last_run_at = EXCLUDED.last_run_at,
             total_indexed = backfill_state.total_indexed + EXCLUDED.total_indexed,
             updated_at = EXCLUDED.updated_at`,
      [pendingKey, wsId, cursorValue, now, sources.length],
    )

    return { sessionId, entity: { type: entityType, value: entityValue }, sources: sources.length, candidate: candidatePath }
  } catch (err) {
    log.error("Entity curation failed to start", { error: (err as Error).message })
    return { error: (err as Error).message }
  }
}

/**
 * Pick the entity with the most unprocessed sources and curate it.
 * Used by the scheduled/loop driver.
 */
export async function curateNextEntity(
  workspacePath: string,
  workspaceId?: string,
): Promise<CurateResult> {
  const wsId = workspaceId || "agent"
  const top = await topUnprocessedEntities(wsId, 1)
  if (top.length === 0) return { skipped: "no unprocessed entities" }
  const { entity_type, entity_value } = top[0]!
  return curateEntity(workspacePath, entity_type, entity_value, wsId)
}

/**
 * Process a <new-entities> block found in a completed curation session's
 * output. Call from an operator tool after a session completes.
 */
export async function recordDiscoveredEntities(
  workspaceId: string,
  pluginId: string,
  sourcePaths: string[],
  rawBlock: string,
): Promise<number> {
  const discovered = parseDiscoveredEntities(rawBlock)
  return insertDiscoveredEntities(workspaceId, pluginId, sourcePaths, discovered)
}
