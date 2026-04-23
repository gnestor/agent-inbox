/**
 * Entity curation — one Claude session per entity.
 *
 * Given an entity (type + value), gather all unprocessed sources that mention
 * it, locate the candidate curated context page (via tiered lookup), and
 * dispatch a tightly-scoped session that updates or creates the page, discovers
 * new entities, and leaves links behind.
 *
 * Session lifecycle runs through `runBackgroundCurationSession`: sessions use
 * CWD = `{workspace}/context`, skip creating rows in `sessions`, and advance
 * state via the `onComplete` callback (marking sources processed here). A
 * stale-lock TTL recovers from server crashes that leave pending rows behind.
 */

import { readFile } from "fs/promises"
import { join, resolve } from "path"
import { execFile } from "child_process"
import { promisify } from "util"
import { createLogger } from "./logger.js"

const execFileAsync = promisify(execFile)
import {
  canonicalize,
  topUnprocessedEntities,
  unprocessedSourcesForEntity,
  markProcessed,
  insertDiscoveredEntities,
} from "./entity-extractor.js"
import { runBackgroundCurationSession } from "./curation-session.js"
import type { Entity } from "../../src/types/plugin.js"

const log = createLogger("entity-curator")

const CURATOR_KEY_PREFIX = "entity-curation"

// Domains that appear across many unrelated pages. Skipping auto-candidate for
// these forces the agent to find the canonical curated page via INDEX.md
// (e.g. shopify.com → shopify-store.md, not a random page that mentions Shopify).
const AMBIGUOUS_DOMAINS = new Set([
  "shopify.com", "instagram.com", "facebook.com", "meta.com",
  "google.com", "youtube.com", "tiktok.com", "pinterest.com",
  "klaviyo.com", "gorgias.com", "notion.so", "slack.com",
  "stripe.com", "paypal.com", "quickbooks.com", "gusto.com",
  "shopify.io", "fb.com",
])

type CurateResult =
  | { sessionId: string; entity: { type: string; value: string }; sources: number; candidate: string | null }
  | { skipped: string }
  | { error: string }

/**
 * Strip the leading `context/` segment from a path stored in source_entities
 * so it becomes relative to the curation CWD.
 */
function toCurationRelative(pathFromWorkspace: string): string {
  return pathFromWorkspace.startsWith("context/")
    ? pathFromWorkspace.slice("context/".length)
    : pathFromWorkspace
}

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
 * Tiered candidate-page lookup. Returned path is relative to the context
 * directory (no `context/` prefix) so it's usable directly from the curation
 * session's CWD.
 *  1. Canonical slug → <slug>.md
 *  2. ripgrep literal match
 *  3. qmd query (local Qwen expansion, no Claude)
 */
async function findCandidatePage(
  contextDir: string,
  entityType: string,
  entityValue: string,
): Promise<string | null> {
  const slug = entityToSlug(entityType, entityValue)

  const slugPath = join(contextDir, `${slug}.md`)
  try {
    await readFile(slugPath, "utf8")
    return `${slug}.md`
  } catch { /* not found */ }

  // For person-emails, the ripgrep+qmd fallbacks produce false positives on
  // pages whose title shares the local-part (e.g. sarah@hammies.com →
  // sarah-kozusko.md). Skip auto-match and let the agent find the right page
  // via INDEX.md, which has full entity names and tags.
  if (entityType === "person" && entityValue.includes("@")) {
    return null
  }

  // Ubiquitous third-party platform domains false-match across dozens of
  // unrelated pages. The agent should find the canonical page via INDEX.md.
  if (entityType === "domain" && AMBIGUOUS_DOMAINS.has(entityValue.toLowerCase())) {
    return null
  }

  try {
    const { stdout } = await execFileAsync(
      "rg",
      ["-l", "--max-depth", "1", "-F", entityValue, "--glob", "*.md", "--glob", "!INDEX.md", "--glob", "!LOG.md", "--glob", "!SCHEMAS.md", "--glob", "!_template.md", contextDir],
      { encoding: "utf8" },
    )
    if (stdout.trim()) {
      const lines = stdout.trim().split("\n")
      const preferred = lines.find((p) => p.toLowerCase().includes(slug))
      const pick = preferred ?? lines[0]!
      return pick.startsWith(contextDir) ? pick.slice(contextDir.length).replace(/^\/+/, "") : pick
    }
  } catch { /* rg exit 1 (no matches) or not installed */ }

  try {
    const { stdout } = await execFileAsync(
      "qmd",
      ["query", entityValue, "-c", "context", "--files", "-n", "10"],
      { encoding: "utf8" },
    )
    if (stdout.trim()) {
      for (const line of stdout.trim().split("\n")) {
        const m = line.match(/qmd:\/\/context\/(\S+\.md)/)
        if (!m) continue
        const path = m[1]!
        // Top-level pages only (no slash) — excludes source subdirs
        if (!path.includes("/")) return path
      }
    }
  } catch { /* qmd not installed or no results */ }

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
    ? `## Candidate page — verify, then update

Automated lookup found this page as a likely match for this entity:

Path: \`${candidatePath}\`

\`\`\`markdown
${candidateContent}
\`\`\`

Before editing, confirm this page is actually about the entity (\`${entityType}: ${entityValue}\`). If it's the wrong page, search \`INDEX.md\` for a better match or create a new page with slug \`${entityToSlug(entityType, entityValue)}.md\`.`
    : `## No candidate page found

Automated lookup (slug → ripgrep → qmd) did not find an existing page for this entity. Before creating a new one:

1. Read \`INDEX.md\` — an existing page may use a different slug than the entity value. For example, \`thesourcingco.net\` is about "The Sourcing Company" and likely corresponds to \`sourcing-company.md\`. \`kurt@incip.com\` likely corresponds to \`kurt-koenig.md\`. Always prefer updating an existing page over creating a duplicate.
2. If nothing in INDEX.md matches, create a new page with slug \`${entityToSlug(entityType, entityValue)}.md\` and add an entry to \`INDEX.md\`.`

  return `You are maintaining a single entity's page in Hammies' relationship index.

Your working directory is the \`context/\` folder — all paths below are relative to it.

## Entity
- **Type:** ${entityType}
- **Value:** ${entityValue}

## What this page is for

The page is a **navigation index**, not a knowledge summary. Agents querying
this entity will follow the source links and read the actual files themselves
(they can also search via qmd). The page exists only to point them to the
right sources and list related entities.

## Required format (only these sections)

- Frontmatter: \`tags\`, \`last_updated\`
- One-line identity (≤ 15 words): who/what this entity is, plain language
- \`## Sources\` — flat list of links, grouped by source type
  - Subheadings: \`### Gmail\`, \`### Gorgias\`, \`### Drive\`, \`### Notion\`, \`### Slack\`, \`### Sessions\` (only the types that have sources)
  - Format per item: \`- [<short label>](<path>)\`
  - Label should come from the source's frontmatter/title (see "Labeling sources" below)
- \`## Related\` — one-line links to other curated entity pages
  - Format: \`- [<Name>](<file>.md) — <2-4 word role>\`

## Do NOT write

- A \`## Details\` section with attributes or facts
- A \`## Timeline\` with dated events
- Any prose paragraphs describing what the entity does, means, or relates to
- Anything extracted from source content (attributes, dates, decisions, quotes)

If an existing page already has prose sections (Details, Timeline, etc),
LEAVE THEM ALONE — do not delete, extend, or reformat them. Only modify
\`last_updated\`, \`## Sources\`, and \`## Related\`.

## Labeling sources

Use \`grep -h '^title:\\|^subject:\\|^# ' <paths>\` (or similar batch read) to
extract a short label from each source's frontmatter or first heading.
Fallback: use the filename stem (\`thread-abc123\` → "thread abc123"). You
don't need to read source bodies — you're linking, not summarizing.

## Entity discovery

While scanning source frontmatter/titles, note any person, company, product,
project, folder, or channel that deserves its own page. End your response with:

<new-entities>
entity_type: canonical_value
...
</new-entities>

Use the same entity types (person, company, product, project, folder, channel, tag, etc.). Do not emit an entity for the one you're currently curating.

${candidateSection}

## Sources to process (${sourcePaths.length})

${sourceList}

## Output

- Append missing entries to \`## Sources\` under the correct type heading
- Add any newly-identified related pages to \`## Related\` with a role label
- Update \`last_updated\` in frontmatter
- Append one line to \`LOG.md\`:
  \`| YYYY-MM-DD | updated | <filename> | +<N> sources, +<M> related |\`
- End with the \`<new-entities>\` block (empty if none discovered)

Do NOT dispatch background subagents.`
}

export async function curateEntity(
  workspacePath: string,
  entityType: string,
  entityValue: string,
  workspaceId?: string,
): Promise<CurateResult> {
  const wsId = workspaceId || "agent"
  const pendingKey = `${CURATOR_KEY_PREFIX}:${entityType}:${entityValue}:pending`

  const sources = await unprocessedSourcesForEntity(wsId, entityType, entityValue)
  if (sources.length === 0) {
    return { skipped: `no unprocessed sources for ${entityType}:${entityValue}` }
  }

  const contextDir = resolve(workspacePath, "context")
  const candidatePath = await findCandidatePage(contextDir, entityType, entityValue)
  let candidateContent: string | null = null
  if (candidatePath) {
    try {
      candidateContent = await readFile(join(contextDir, candidatePath), "utf8")
    } catch {
      candidateContent = null
    }
  }

  // source_entities stores workspace-relative paths; strip "context/" so the
  // agent can reference them from its CWD.
  const promptSources = sources.map(toCurationRelative)
  const prompt = buildEntityPrompt(entityType, entityValue, candidatePath, candidateContent, promptSources)

  const result = await runBackgroundCurationSession({
    workspacePath,
    workspaceId: wsId,
    pendingKey,
    prompt,
    linkedItemTitle: `Entity curation — ${entityType}: ${entityValue} (${sources.length} sources)`,
    onComplete: async () => {
      await markProcessed(wsId, entityType, entityValue, sources)
      log.info("Entity curation complete", {
        entity: `${entityType}:${entityValue}`,
        sources: sources.length,
      })
    },
  })

  if ("sessionId" in result) {
    return { sessionId: result.sessionId, entity: { type: entityType, value: entityValue }, sources: sources.length, candidate: candidatePath }
  }
  return result
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
