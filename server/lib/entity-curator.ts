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
import { createLogger } from "@hammies/frontend/lib/serverLogger"

const execFileAsync = promisify(execFile)
import {
  canonicalize,
  topUnprocessedEntities,
  unprocessedSourcesForEntity,
  markProcessed,
  insertDiscoveredEntities,
  rollupPersonsToDomains,
} from "./entity-extractor.js"
import { gateEntity } from "./entity-gate.js"
import { runBackgroundCurationSession } from "./curation-session.js"
import type { Entity } from "../../src/types/plugin.js"

const log = createLogger("entity-curator")

const CURATOR_KEY_PREFIX = "entity-curation"

// Bounds on how much page content we paste into the prompt. Pasting a
// 2000-line canonical page on every contact-curation session is the dominant
// input-token cost. Cap at a generous prefix; the agent can `Read` the file
// for more if it needs the rest.
const MAX_CANDIDATE_CHARS = 6000
const MAX_PARENT_COMPANY_CHARS = 6000

// Cap on sources passed in the prompt. The DB query already pulls at most
// 100; this is a second cap at prompt-build time so the agent doesn't waste
// tokens scanning a 100-line filename list it won't fully process.
const MAX_SOURCES_IN_PROMPT = 30

// Minimum unprocessed-source count before dispatching a curation session for
// a low-priority entity type. Folder/tag/project entities with one or two
// sources almost never produce a useful curated page.
const MIN_SOURCES_BY_TYPE: Record<string, number> = {
  folder: 5,
  tag: 5,
  project: 3,
  product: 3,
  channel: 3,
}

/** Truncate content to a char budget, marking truncation. */
function clip(content: string, max: number): string {
  if (content.length <= max) return content
  return content.slice(0, max) + `\n\n... (truncated ${content.length - max} chars; Read the file for full content)`
}

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
 * If the entity is a person-with-email AND a curated page exists for the
 * email's domain (e.g. `pam.watson@ecomcpa.com` → `ecomcpa.md`), return the
 * domain page. The agent should be told to enrich the company page rather
 * than create a separate person page.
 *
 * Looks up by canonical slug only (cheap; no full-text search). Returns the
 * domain-page path relative to the context directory, or null.
 */
async function findParentCompanyPage(
  contextDir: string,
  entityType: string,
  entityValue: string,
): Promise<string | null> {
  if (entityType !== "person" || !entityValue.includes("@")) return null
  const domain = entityValue.split("@")[1]?.toLowerCase()
  if (!domain) return null
  // Slug derivation matches a typical company-page name: `ecomcpa.com` →
  // `ecomcpa`, `webster-pacific.com` → `webster-pacific`. Drops TLD and
  // converts dots to hyphens.
  const tldStripped = domain.replace(/\.[a-z]{2,}$/i, "")
  const slug = tldStripped.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  if (!slug) return null

  // Try a few candidate slugs in order of likelihood.
  const candidates = [`${slug}.md`]
  // Also try the un-stripped form (e.g. ecomcpa-com.md) for older pages we
  // haven't renamed yet.
  if (slug !== tldStripped.replace(/\./g, "-")) {
    candidates.push(`${tldStripped.replace(/\./g, "-")}.md`)
  }

  for (const candidate of candidates) {
    try {
      await readFile(join(contextDir, candidate), "utf8")
      return candidate
    } catch { /* not found */ }
  }
  return null
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

  // Try canonical slug first
  const candidateSlugs = [slug]

  // For domain entities, also try the TLD-stripped form because most
  // brand-named pages use the bare brand name (gusto.md, free-people.md)
  // rather than the dotted-domain form (gusto-com.md, free-people-com.md).
  if (entityType === "domain") {
    const tldStripped = entityValue.toLowerCase().replace(/\.[a-z]{2,}(?:\.[a-z]{2,})?$/i, "")
    const brandSlug = tldStripped.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    if (brandSlug && brandSlug !== slug) candidateSlugs.push(brandSlug)
  }

  for (const s of candidateSlugs) {
    try {
      await readFile(join(contextDir, `${s}.md`), "utf8")
      return `${s}.md`
    } catch { /* not found */ }
  }

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
      ["-l", "--max-depth", "1", "-F", entityValue, "--glob", "*.md", "--glob", "!INDEX.md", "--glob", "!LOG.md", "--glob", "!SCHEMAS.md", contextDir],
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

/**
 * Check whether ANY of the given source files shows evidence of Hammies
 * outbound engagement (a reply from staff, a comped order, a signed
 * agreement). Used to gate entities whose unprocessed sources are pure
 * cold inbound — those fail the eligibility rule (≥1 outbound required)
 * and shouldn't pay for an LLM session to no-op.
 *
 * Heuristics by source type:
 * - `gorgias/*.md` — generated by gorgias plugin's itemToContext as
 *   `### Agent: <Name>` headers when from_agent=true. Presence of any
 *   such header proves Hammies replied.
 * - `gmail/*.md` — generated by gmail plugin with per-message `### From:`
 *   or `### Agent:` for hammies@/grant@/sarah@/support@ senders. Match
 *   the @hammies.com or @hammiesshorts.com domains in the body.
 * - `notion/*`, `sessions/*`, `google-drive/*` — these source types are
 *   inherently substantive (notion tasks, agent sessions, drive files
 *   we authored) and never represent pure cold inbound. Treat as engaged.
 *
 * Returns true on first match; only returns false if EVERY source is
 * checked and shows zero engagement.
 */
async function hasHammiesEngagement(
  workspacePath: string,
  sourcePaths: string[],
): Promise<boolean> {
  if (sourcePaths.length === 0) return false
  const HAMMIES_SENDER_RE = /@(?:hammies\.com|hammiesshorts\.com|hammies\.shorts)\b/i
  const contextDir = resolve(workspacePath, "context")
  for (const sp of sourcePaths) {
    let text: string
    try {
      text = await readFile(join(contextDir, sp), "utf8")
    } catch {
      continue
    }
    if (sp.startsWith("gorgias/")) {
      // gorgias/itemToContext writes `### Agent: <Name> — <ts>` blocks for
      // from_agent=true messages. Presence of any such header = engagement.
      if (/^###\s+Agent:/m.test(text)) return true
    } else if (sp.startsWith("gmail/")) {
      // gmail/itemToContext renders messages with sender info. Any Hammies-
      // domain email in the rendered body indicates we sent a message.
      if (HAMMIES_SENDER_RE.test(text)) return true
    } else {
      // notion/, sessions/, google-drive/, slack/ — author is implicitly
      // Hammies (we wrote these). Any one of these counts as engagement.
      return true
    }
  }
  return false
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
  parentCompanyPath: string | null,
  parentCompanyContent: string | null,
): string {
  const sourceList = sourcePaths.map((p) => `- ${p}`).join("\n")

  // Parent-company hint takes precedence over standalone-page creation when
  // the candidate is a person at a domain we already curate. Steers the
  // agent toward "add Personnel detail to the company page" instead of
  // "create a new person page".
  const parentHintSection = parentCompanyPath && parentCompanyContent
    ? `## Parent company page exists — prefer enriching it

This entity is a person at a domain we already curate. The canonical home is
usually the company page, not a separate person page.

Path: \`${parentCompanyPath}\`

\`\`\`markdown
${clip(parentCompanyContent, MAX_PARENT_COMPANY_CHARS)}
\`\`\`

**How to merge:**
- If the company page has a Contacts table, ensure this person is listed (add a row if missing).
- If the company page has a "Personnel detail" section (or similar), add a \`### <Name> — <role>\` subsection there with their non-obvious role/timeline. Match the existing structure of any sibling subsections.
- Only create a separate person page if (a) the person has a non-trivial story that wouldn't fit as a subsection on the company page, OR (b) they're notable across multiple companies.

If you do enrich the company page, log to \`LOG.md\` against the company page filename (not the person's email) so future runs find the change.

`
    : ""

  const candidateSection = candidatePath && candidateContent
    ? `## Candidate page — verify, then update

Automated lookup found this page as a likely match for this entity:

Path: \`${candidatePath}\`

\`\`\`markdown
${clip(candidateContent, MAX_CANDIDATE_CHARS)}
\`\`\`

Before editing, confirm this page is actually about the entity (\`${entityType}: ${entityValue}\`). If it's the wrong page, search \`INDEX.md\` for a better match or create a new page with slug \`${entityToSlug(entityType, entityValue)}.md\`.`
    : `## No candidate page found

Automated lookup (slug → ripgrep → qmd) did not find an existing page for this entity. Before creating a new one:

1. Read \`INDEX.md\` — an existing page may use a different slug than the entity value. For example, \`thesourcingco.net\` is about "The Sourcing Company" and likely corresponds to \`sourcing-company.md\`. \`kurt@incip.com\` likely corresponds to \`kurt-koenig.md\`. Always prefer updating an existing page over creating a duplicate.
2. If nothing in INDEX.md matches, create a new page with slug \`${entityToSlug(entityType, entityValue)}.md\` and add an entry to \`INDEX.md\`.`

  return `You are maintaining a single entity's page in Hammies' relationship index.

${parentHintSection}

Your working directory is the \`context/\` folder — all paths below are relative to it.

## Entity
- **Type:** ${entityType}
- **Value:** ${entityValue}

## What this page is for

This page captures **non-obvious connections** about the entity. qmd already
does full-text search across all source files — an agent can query "Caroline
Tuerk emails" and get every thread. This page exists for what qmd CAN'T
surface: the synthesized role of the entity in Hammies, the relationships to
other entities, and the chronology of the relationship.

**Rule of thumb:** a sentence belongs on this page only if it's not directly
extractable from a single source file. "Caroline emailed about MOQ on Mar 3"
does NOT belong — it's already in the source. "Caroline is the sales rep for
Wuxi Hende, Hammies' primary corduroy factory; relationship via INCIP intro
in 2019" DOES belong — no single source says that.

## First: is this entity worth curating?

Before writing anything, decide. A page is worthwhile only if:
- The entity is a real person, company, product, project, or meaningful folder
  (not a generic term, technical subfolder, automated sender, or internal file label).
- Reading the linked sources would leave an agent needing ADDITIONAL synthesis.
- There is at least one non-obvious connection to capture (role, relationship, chronology).

If the entity is noise (spam sender, Klaviyo/Mailchimp subfolder, generic
admin folder, opaque ID), **do NOT create a page**. Instead, respond only
with an empty \`<new-entities>\` block and a brief explanation. Do not touch
\`LOG.md\` or \`INDEX.md\` for skipped entities.

## Required structure (for entities worth curating)

Frontmatter:
\`\`\`yaml
---
tags: [<type>, <1-3 topical tags>]
last_updated: YYYY-MM-DD
---
\`\`\`

**Body sections (in order):**

1. **One-sentence identity** (≤ 20 words) — who/what this is, grounded in
   Hammies context. E.g., "Caroline Tuerk — sales rep at Wuxi Hende, Hammies'
   corduroy factory since 2019."

2. \`## Role\` (2-5 short bullets) — the non-obvious facts about this entity's
   place in Hammies. Each bullet must state a connection, not a restatement.
   Bad: "Sends emails about orders." Good: "Main point of contact for
   Pacifica PO series (PO-11 through PO-46)."

3. \`## Relationships\` — bulleted links to other entities, with the WHY on
   each line. Format: \`- [Name](file.md) — <relationship in 5-15 words>\`.
   Prefer specific over generic: "referred Kurt Koenig @ INCIP for Levi's
   lawsuit (Feb 2022)" beats "colleague".

4. \`## Timeline\` — dated milestones **of the relationship**, not a digest
   of source files. Only include events that mark a change: first contact,
   role change, major decision, recurring pattern onset. Each entry:
   \`- YYYY-MM-DD: <event> — [source](path)\`. If you can't name the event in
   one short clause, it's probably not timeline-worthy.

5. \`## Sources\` — flat list grouped by source type (\`### Gmail\`,
   \`### Gorgias\`, \`### Drive\`, \`### Notion\`, \`### Sessions\`).
   Format: \`- [<short label>](<path>)\`. This section IS a link dump — qmd
   already indexes these, but listing them here gives agents a scoped view.

## Paths (critical — get these right)

You are in \`context/\`. Links to other pages in this directory are bare
filenames. Links to source stubs in subdirectories use the subdirectory prefix.
All source stubs now live under \`context/\` — no \`../\` prefixes anywhere.

- Curated page: \`[Title](filename.md)\`
- Gmail source: \`[Subject](gmail/threadId.md)\`
- Gorgias source: \`[Ticket #id](gorgias/ticketId.md)\`
- Notion source: \`[Title](notion/pageId.md)\`
- Slack source: \`[Channel](slack/channelId.md)\`
- Drive source: \`[Filename](google-drive/fileId.md)\`
- Session source: \`[Summary](sessions/sessionId.md)\`

Broken paths defeat the whole point of the index — double-check before saving.

## Reading discipline

- You do NOT need to read every source body. Batch-grep frontmatter/titles
  with \`grep -h '^title:\\|^subject:\\|^# ' <paths>\` or similar for the
  Sources list.
- You SHOULD read 3-10 representative source bodies when writing Role,
  Relationships, or Timeline — you can't synthesize connections without
  reading something. Pick the ones likely to reveal the most context (recent,
  long threads, decisions).
- If you read nothing beyond frontmatter and still write prose, you're
  hallucinating.

## Existing pages

If the candidate page has prose you'd otherwise write, EXTEND it — add new
Relationships, Timeline entries, and Sources. Don't delete or rewrite what's
there unless it's factually wrong. Update \`last_updated\`.

${candidateSection}

## Sources to process (${sourcePaths.length})

${sourceList}

## Entity discovery

While reading, note any other person/company/product/project that deserves
its own page. End with:

<new-entities>
entity_type: canonical_value
...
</new-entities>

(Empty block is fine.) Do not emit the entity you're currently curating.

## Process improvement (act when you spot a recurring pattern)

The pipeline only gets sharper if you feed signal back into it. When you skip
an entity for a deterministic reason, OR when one of the sources you read is
clearly noise that shouldn't be in the context index at all, do ONE more thing
in addition to the skip — but cap yourself at 1–2 such edits per session.

**Tier 1 — edit the noise filters directly** (low-risk, pure data; the user
reviews the diff before committing):

- Personal-email / promotional / automated-sender domain that recurs →
  append to the matching constant in \`../plugins/workspace-filters.ts\`.
- Generic folder that recurs → append to \`GENERIC_FOLDERS\` in the same file.
- New automated-sender prefix or promo-subdomain pattern → extend the
  \`AUTOMATED_LOCAL_RE\` or \`PROMO_SUBDOMAIN_RE\` regex.

**Tier 2 — edit a plugin's \`itemToContext\`** for source items that should
never reach context (auto-replies, internal-only notifications,
status-change webhooks, empty Instagram comments, etc.):

- Edit only \`../plugins/<id>/plugin.ts\` and add a \`return null\` branch
  inside \`itemToContext\`. Keep the matcher narrow and add a one-line comment
  with an example trigger.
- NEVER edit \`query\` — it drives the UI list view.

**Tier 3 — write to \`proposals.md\`** for schema, template, prompt, or
ranking changes (operator reviews and applies):

- Path: \`proposals.md\` (you're already in \`context/\`).
- Append a row to the table:
  \`| YYYY-MM-DD | <area> | <proposed change> | <rationale + 1-2 source paths> |\`
- Areas: \`schema\`, \`template\`, \`prompt\`, \`ranking\`, \`other\`.

**For all three tiers**, also append one row to \`LOG.md\` so the change is
auditable alongside the curation work:
\`| YYYY-MM-DD | filter-update or proposal | <file or area> | <one-line what & why> |\`

Do not bulk-edit. The same pattern will resurface; we'd rather catch it on
the third sighting than over-edit on the first. Do NOT commit your edits —
the user reviews the diff and commits.

## Output

- Either: update/create the entity's page per the structure above
- Or: skip (entity isn't worth curating) — respond only with explanation + empty \`<new-entities>\`
- If you updated/created: append one line to \`LOG.md\`:
  \`| YYYY-MM-DD | created|updated|skipped | <filename or entity> | <1-line what changed> |\`
- If you skipped: log it too so we can audit the skip rate.

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

  // Deterministic skip gate runs before fetching sources or dispatching a
  // session. Sources still get marked processed so the queue advances.
  const gate = gateEntity(entityType, entityValue)
  if (gate.skip) {
    const sources = await unprocessedSourcesForEntity(wsId, entityType, entityValue)
    if (sources.length > 0) {
      await markProcessed(wsId, entityType, entityValue, sources)
    }
    log.info("Entity gated (deterministic skip)", {
      entity: `${entityType}:${entityValue}`,
      reason: gate.reason,
      sources: sources.length,
    })
    return { skipped: `gated: ${gate.reason}` }
  }

  // Cap the fetch at MAX_SOURCES_IN_PROMPT so the prompt stays bounded.
  // Remaining sources beyond this batch are picked up by subsequent runs
  // after the first batch is marked processed.
  const sources = await unprocessedSourcesForEntity(wsId, entityType, entityValue, MAX_SOURCES_IN_PROMPT)
  if (sources.length === 0) {
    return { skipped: `no unprocessed sources for ${entityType}:${entityValue}` }
  }

  // Min-source threshold: low-priority entity types (folder/tag/project)
  // with very few sources rarely produce useful curated pages. Auto-skip
  // and mark the sources processed so the queue moves on.
  const minThreshold = MIN_SOURCES_BY_TYPE[entityType] ?? 0
  if (minThreshold > 0 && sources.length < minThreshold) {
    await markProcessed(wsId, entityType, entityValue, sources)
    log.info("Entity below min-source threshold (auto-skip)", {
      entity: `${entityType}:${entityValue}`,
      sources: sources.length,
      threshold: minThreshold,
    })
    return { skipped: `below min-source threshold (${sources.length} < ${minThreshold} for ${entityType})` }
  }

  const contextDir = resolve(workspacePath, "context")
  const candidatePath = await findCandidatePage(contextDir, entityType, entityValue)

  // Engagement gate: an entity whose unprocessed sources show NO Hammies
  // outbound — pure cold-pitch / inbound-only — fails the eligibility rule
  // (≥1 inbound + ≥1 outbound + affirmative outcome). The curation prompt
  // says to no-op on these but the curator hasn't been reliable. Skipping
  // upfront avoids the LLM session entirely. Only applies to person/domain/
  // company (the entity types where engagement is well-defined).
  //
  // Bypass when a curated page already exists — the gate is meant to prevent
  // CREATING pages for cold-pitch entities, not to block UPDATES (new timeline
  // entries, etc.) to entities we've already affirmed via prior curation.
  if (
    !candidatePath &&
    (entityType === "person" || entityType === "domain" || entityType === "company")
  ) {
    const engaged = await hasHammiesEngagement(workspacePath, sources)
    if (!engaged) {
      await markProcessed(wsId, entityType, entityValue, sources)
      log.info("Entity gated (no Hammies engagement, no existing page)", {
        entity: `${entityType}:${entityValue}`,
        sources: sources.length,
      })
      return { skipped: `gated: no Hammies engagement (cold-pitch only, ${sources.length} sources)` }
    }
  }

  let candidateContent: string | null = null
  if (candidatePath) {
    try {
      candidateContent = await readFile(join(contextDir, candidatePath), "utf8")
    } catch {
      candidateContent = null
    }
  }

  // Parent-company hint: only meaningful for person-with-email and only when
  // the candidate page isn't already that company page (avoid duplicate
  // injection). Resolved independently of the candidate-lookup so we can
  // surface the company even when the slug lookup found a different page.
  const parentCompanyPath = await findParentCompanyPage(contextDir, entityType, entityValue)
  let parentCompanyContent: string | null = null
  if (parentCompanyPath && parentCompanyPath !== candidatePath) {
    try {
      parentCompanyContent = await readFile(join(contextDir, parentCompanyPath), "utf8")
    } catch {
      parentCompanyContent = null
    }
  }

  // source_entities stores workspace-relative paths; strip "context/" so the
  // agent can reference them from its CWD.
  const promptSources = sources.map(toCurationRelative)
  const prompt = buildEntityPrompt(
    entityType,
    entityValue,
    candidatePath,
    candidateContent,
    promptSources,
    parentCompanyPath !== candidatePath ? parentCompanyPath : null,
    parentCompanyPath !== candidatePath ? parentCompanyContent : null,
  )

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
  // Roll up person entities whose domain has its own entity into the domain
  // before picking. Avoids paying for a session that the prompt would tell
  // to no-op anyway.
  const rolled = await rollupPersonsToDomains(wsId)
  if (rolled > 0) {
    log.info("Rolled up person entities into matching domain entities", { rolled, workspaceId: wsId })
  }
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
