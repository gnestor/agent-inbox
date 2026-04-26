# Context System

The inbox app maintains a workspace-scoped **relationship index** — a curated knowledge base of people, companies, projects, and other entities that the agent can read and write to during sessions. The system is built around four cooperating stages that run continuously in the background and a small number of operator tools for cleanup.

This doc explains the pipeline end-to-end: how raw source items become curated entity pages, where every component lives, how the database tracks state, and what knobs you have to control cost and behavior.

Related docs:
- [`plugin-system.md`](plugin-system.md) — the plugin interface (this doc deepens the context-related methods)
- [`SCHEMAS.md`](../../agent/context/SCHEMAS.md) (in the agent workspace) — required structure for curated pages
- [`_template.md`](../../agent/context/_template.md) (in the agent workspace) — template a new curated page should match

---

## What the system produces

A workspace's `context/` directory ends up looking like:

```
{workspace}/context/
├── INDEX.md                          ← agent-readable index of all curated pages
├── LOG.md                            ← append-only log of every curation action
├── SCHEMAS.md                        ← required structure for new pages
├── _template.md                      ← copy-as-starting-point for new pages
├── grant-nestor.md                   ← curated entity page (person)
├── distribution-management.md        ← curated entity page (company)
├── prism-boutique.md                 ← curated entity page (company w/ contacts)
├── ...
├── gmail/                            ← raw stubs from the gmail plugin
│   └── {threadId}.md
├── gorgias/
│   └── {ticketId}.md
├── notion-tasks/
│   └── {pageId}.md
└── sessions/
    └── {sessionId}.md
```

Plus a sibling directory for stubs that don't belong in the qmd-indexed tree:

```
{workspace}/backfill-cache/
└── google-drive/
    └── {fileId}.md
```

The two layers serve different needs:

- **Curated pages** (top-level `context/*.md`) — synthesized relationship index. Authoritative. Read first by agents looking for "who is X" or "what's our relationship with Y". Inline links to sources.
- **Raw stubs** (`context/{plugin}/*.md`, `backfill-cache/{plugin}/*.md`) — one file per source item (email thread, ticket, doc, etc.) with frontmatter metadata + cleaned body. Written by plugins, indexed by qmd, never edited by sessions.

---

## Pipeline overview

```
                    ┌─────────────────────────────────────────────────────────┐
                    │  BACKGROUND PIPELINE (runs continuously, idempotent)    │
                    └─────────────────────────────────────────────────────────┘

  Plugin source (Gmail/Notion/etc.)
            │
            │  plugin.query() + plugin.itemToContext()
            ▼
  ┌──────────────────────┐
  │  Stage 1: RAW         │   Writes:  context/{plugin}/{id}.md (stub w/ frontmatter)
  │  BACKFILL             │   Tracks:  backfill_state.cursor per plugin
  │                       │
  │  context-backfill-    │
  │  scheduler.ts         │
  └──────────────────────┘
            │
            │  body-extractor (Ollama Qwen3.5)
            ▼
  ┌──────────────────────┐
  │  Stage 2: BODY        │   Reads:   raw stub
  │  EXTRACTION           │   Writes:  same stub w/ cleaned `body:` field
  │                       │   Tracks:  body_extraction_log
  │  body-extractor.ts    │
  └──────────────────────┘
            │
            │  plugin.extractEntities() | regex fallback
            ▼
  ┌──────────────────────┐
  │  Stage 3: ENTITY      │   Reads:   stub frontmatter
  │  EXTRACTION           │   Writes:  source_entities (entity → source rows)
  │                       │
  │  entity-extractor.ts  │
  └──────────────────────┘
            │
            │  curate-loop polls /curate-entity/next every 15s
            ▼
  ┌──────────────────────┐
  │  Stage 4: ENTITY      │   Reads:   source_entities + candidate page
  │  CURATION             │   Writes:  context/{entity-slug}.md (curated page)
  │                       │   Updates: INDEX.md, LOG.md, source_entities (mark processed)
  │  entity-curator.ts    │
  └──────────────────────┘
            │
            │ <new-entities> block
            ▼
  ┌──────────────────────┐
  │  Discovery feedback  │   Inserts new entity rows back into source_entities
  └──────────────────────┘
```

Each stage is independently restartable; nothing is lost if the server or loop crashes.

---

## Stage 1 — Raw backfill

**Goal:** mirror every plugin's source items into the workspace as flat markdown stubs, so qmd can index them and the agent can read individual items by ID.

**File:** [`server/lib/context-backfill-scheduler.ts`](../server/lib/context-backfill-scheduler.ts)

**Code path:**

1. `runContextBackfill()` is called every 30 minutes by `scheduleContextBackfill()`. It iterates every plugin that exposes both `query()` and `itemToContext()`.
2. For each plugin, `runBackfill()` (in `server/routes/backfill.ts`) walks pages of `plugin.query()` from the cursor stored in `backfill_state`, calls `plugin.itemToContext(item)` to produce stub markdown, and writes one file per item to `context/{plugin.id}/{item.id}.md` (or to `plugin.backfillDir` if overridden).
3. After each successful page, the cursor is advanced. A failure recoverably restarts from the last successful cursor.

### Plugin contract

```typescript
interface Plugin {
  query?(filters, cursor, ctx): Promise<QueryResult>
  itemToContext?(item: PluginItem): string | null
  backfillDir?: string  // override default `context/{id}/`
}
```

- `itemToContext` returns frontmatter+body markdown, or `null` to skip the item entirely (the plugin's chance to gate noise before it ever hits disk).
- `backfillDir` exists for stubs that shouldn't be qmd-indexed — Drive uses `backfill-cache/google-drive/` so file body content (often binary or huge) doesn't pollute search. The `..` prefix is then required when curated pages link to those stubs.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/backfill/:pluginId` | Run a single plugin's backfill |
| POST | `/api/backfill/` | Run all plugins |

### State

`backfill_state` table:
```sql
plugin_id      TEXT PRIMARY KEY
cursor         TEXT          -- opaque resumable cursor (plugin-defined)
updated_at     TEXT NOT NULL
```

The same table is reused by the curation lifecycle for pending-row locks (see Stage 4); the `plugin_id` column doubles as a generic "lock key" — curation rows use `plugin_id = "entity-curation:<type>:<value>:pending"`.

---

## Stage 2 — Body extraction

**Goal:** produce a clean, summarized `body` field on each raw stub so downstream stages don't need to re-parse HTML, decode quoted-printable, or wade through email-signature noise.

**File:** [`server/lib/body-extractor.ts`](../server/lib/body-extractor.ts)

**Why it exists:** Raw email/ticket bodies are messy — HTML markup, quoted thread history, marketing-template boilerplate. Without a cleanup pass, every later stage (entity extraction, entity curation) pays the cost of re-cleaning the same noise.

### What it runs on

A **local Ollama model** (default `qwen3.5:4b`, configurable via `OLLAMA_MODEL`). No Claude tokens are spent here. Configured via env vars:

| Env var | Default | Purpose |
|---------|---------|---------|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama daemon URL |
| `OLLAMA_MODEL` | `qwen3.5:4b` | Model used for body extraction |
| `OLLAMA_NUM_PARALLEL` | (n/a — set on Ollama daemon) | Parallel request limit |

The model takes a stub body and returns a JSON list of entities + a cleaned summary. Ollama's `format: json` mode and `think: false` are used to keep output structured.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/backfill/extract-bodies?source={pluginId}&limit=N` | Extract bodies for up to N stubs of a given source |

The bash loop at `/tmp/body-extract-loop.sh` invokes this endpoint per plugin in a round-robin until each says `"extracted=0"` (no work left).

### State

`body_extraction_log` table — one row per (source_path, workspace_id) marking that body extraction has run for it. The bulk endpoint reads `LEFT JOIN body_extraction_log` to find unprocessed stubs.

```sql
source_path   TEXT
workspace_id  TEXT
plugin_id     TEXT
extracted_at  TIMESTAMPTZ DEFAULT NOW()
entity_count  INTEGER
PRIMARY KEY (source_path, workspace_id)
```

### Noise filters at this stage

`body-extractor.ts` applies regex filters (`AUTOMATED_LOCAL_RE`, `PROMO_SUBDOMAIN_RE`, `NOISY_PERSON_NAMES`, `NOISY_COMPANY_NAMES`) to drop entities that the local model surfaces but shouldn't propagate (mailer-daemons, marketing infra, generic placeholder names). These are the LAST-line filters before entities reach `source_entities`.

---

## Stage 3 — Entity extraction

**Goal:** populate `source_entities` with `(entity_type, entity_value, source_path)` tuples so Stage 4 can group sources by entity rather than processing them chronologically.

**File:** [`server/lib/entity-extractor.ts`](../server/lib/entity-extractor.ts)

This is **deterministic, no LLM**. Plugins implement `extractEntities(item)` to return entities scoped to what each source type reveals; a regex fallback handles plugins that don't override.

### Plugin contract

```typescript
interface Plugin {
  extractEntities?(item: PluginItem): Entity[]
}

interface Entity {
  type: string   // "person" | "company" | "domain" | "folder" | "channel" | ...
  value: string  // canonical form
}
```

Convention by source:

| Source | Typical entities |
|--------|-----------------|
| Gmail | `person:<email>`, `domain:<sender-domain>` |
| Gorgias | `person:<customer-email>`, `domain:<customer-domain>`, `person:<assignee>`, `tag:<gorgias-tag>` |
| Notion | `database:<id>`, `person:<assignee>` |
| Drive | `folder:<name>` for each ancestor in the path, `person:<owner-email>` |
| Sessions | `skill:<name>`, plus type+id of any linked source |
| Slack (when enabled) | `channel:<name>`, `person:<member>` |

### Canonicalization

`canonicalize(type, value)` enforces canonical forms:

- `person`, `domain` → lowercase, trim
- `company`, `folder`, `channel`, `database`, `skill` → lowercase, hyphens for non-alphanumeric, no leading/trailing hyphens

Same person referenced as `Pam Watson` or `pam.watson@ecomcpa.com` will still produce two distinct rows — alias deduplication is a known gap; see [Operator playbook](#operator-playbook) for cleanup.

### Workspace-level filters

[`packages/agent/plugins/workspace-filters.ts`](../../agent/plugins/workspace-filters.ts) provides shared helpers used by every plugin's `extractEntities`:

- `isWorkspaceSelfPerson(name)` — drops the workspace owner so we don't build a self-mega-hub
- `isAutomatedSender(email)` — drops `noreply@`, `notifications@`, etc.
- `isPromotionalDomain(domain)` — drops `em.*`, `news.*`, `bounces.*`, etc.
- `isPersonalEmailDomain(domain)` — drops `gmail.com`, `yahoo.com`, etc. (a `domain:` entity for these is never the canonical home; the matching `person:<email>` is)
- `isGenericFolder(name)` — drops `archive`, `invoices`, `general`, `clicks`, `geo-data`, etc.

The plugin is responsible for not emitting noise in the first place; these helpers are how plugins stay consistent.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/backfill/extract-entities?source={pluginId}` | Bulk-extract entities for stubs of a given source |
| POST | `/api/backfill/record-discovered` | Insert entities discovered by a curation session |

### State

`source_entities` table:

```sql
source_path             TEXT
plugin_id               TEXT
workspace_id            TEXT
entity_type             TEXT
entity_value            TEXT
source_added_at         TEXT
processed_for_entity    INTEGER DEFAULT 0
PRIMARY KEY (source_path, entity_type, entity_value)
```

Indexed on `(workspace_id, entity_type, entity_value, processed_for_entity)` for the entity-lookup read path, plus a partial index on unprocessed rows for `topUnprocessedEntities`.

---

## Stage 4 — Entity curation

**Goal:** for each entity with unprocessed sources, dispatch a Claude session that creates or updates that entity's curated page in `context/{slug}.md`.

**File:** [`server/lib/entity-curator.ts`](../server/lib/entity-curator.ts)

This is **the only stage that costs Claude tokens.** Everything else is local. Cost optimization (Stage 4 specifically) is documented under [Cost & performance](#cost--performance).

### Flow per entity

1. **Pre-curation skip gate** ([`entity-gate.ts`](../server/lib/entity-gate.ts)) — deterministic checks: opaque IDs, personal-email-provider domains, self-domains, noise tags, trivial values. If matched, sources are marked processed and no session is dispatched.
2. **Source fetch** — pull up to `MAX_SOURCES_IN_PROMPT` (30) unprocessed sources from `source_entities`.
3. **Min-source threshold** — for low-priority types (`folder ≥ 5`, `tag ≥ 5`, `project ≥ 3`, `product ≥ 3`, `channel ≥ 3`), if below threshold, mark processed and skip.
4. **Candidate page lookup** (`findCandidatePage`) — tiered, cheapest first:
   1. Canonical slug → `context/{slug}.md`
   2. ripgrep literal match for the entity value (top-level only, excludes meta files)
   3. qmd query — local Qwen expansion + rerank, returns the best top-level page
5. **Parent company hint** (`findParentCompanyPage`) — for `person:<email>` entities, check whether `context/{domain-stem}.md` exists. If so, the prompt includes a section instructing the agent to enrich the company page with a `### Name — role` subsection rather than create a separate person page.
6. **Prompt assembly** (`buildEntityPrompt`) — combines:
   - Entity type+value
   - Parent-company hint section (if applicable, content capped at 6000 chars)
   - Candidate page section (if applicable, content capped at 6000 chars) **or** "no candidate found, search INDEX.md" instructions
   - List of source paths (capped at 30)
   - Schema rules (frontmatter, sections, link-format conventions)
   - Reading discipline (read 3-10 representative source bodies; don't hallucinate)
   - `<new-entities>` block instructions
   - LOG.md / INDEX.md update instructions
7. **Lock + dispatch** (`runBackgroundCurationSession` in [`curation-session.ts`](../server/lib/curation-session.ts)) — atomically claims a `backfill_state` row keyed `entity-curation:{type}:{value}:pending`, dispatches a Claude session via the Agent SDK, and on completion calls `markProcessed` for the sources shown to the agent.
8. **Discovery feedback** — the agent's `<new-entities>` block is parsed by `recordDiscoveredEntities` and inserted back into `source_entities` so newly-named entities get queued for their own curation pass.

### Queue ordering

`topUnprocessedEntities` orders by entity type (domain → company → person → project → product → folder → other) then by source-count descending. This ensures parent company pages exist before contacts trigger curation, so the parent-company hint can fire.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/backfill/curate-entity/next` | Pick the top unprocessed entity and dispatch a session |
| POST | `/api/backfill/curate-entity?type=X&value=Y` | Dispatch a session for a specific entity |
| POST | `/api/backfill/record-discovered` | Insert agent-discovered entities |
| POST | `/api/backfill/curate` | (Legacy) per-source curation — disabled, replaced by entity-curator |

### Lifecycle

```
[curate-loop.sh] → POST /curate-entity/next
                       ↓
                  curateNextEntity()
                       ↓
          topUnprocessedEntities (LIMIT 1)
                       ↓
                  curateEntity(type, value)
                       ↓
                  gateEntity()? → skipped: gated
                       ↓
            unprocessedSourcesForEntity (LIMIT 30)
                       ↓
              minThreshold check → skipped: below threshold
                       ↓
                  findCandidatePage() + findParentCompanyPage()
                       ↓
                  buildEntityPrompt()
                       ↓
            runBackgroundCurationSession()
              ├─ atomic claim of backfill_state pending row
              ├─ startSession() → Agent SDK launches Claude session
              │                   (model = CURATION_MODEL or claude-haiku-4-5)
              ├─ stale-lock TTL (1h) recovers from server crashes
              └─ onComplete → markProcessed(sources) + release lock
```

### Loop driver

The actual continuous-curation pump is a bash loop, not a server timer (the per-source scheduler in `context-backfill-scheduler.ts` is **disabled** — entity-curator replaces it). Default location: `/tmp/curate-loop.sh`. Polls `/curate-entity/next` every 15 seconds when work is found, longer when idle:

```bash
case "$result" in
  *sessionId*)             sleep 15 ;;
  *no\ unprocessed*)       sleep 300 ;;
  *holds\ lock*)           sleep 60 ;;
  *)                       sleep 60 ;;
esac
```

A pause-file escape valve: `touch /tmp/curate.pause` halts the loop without killing it; `rm /tmp/curate.pause` resumes.

### Curation prompt — what the agent sees

The prompt establishes a **connections-first** shape (as opposed to summary-first). The full instruction text lives in `buildEntityPrompt` in [`entity-curator.ts`](../server/lib/entity-curator.ts). Key constraints communicated to the agent:

- A page is for **non-obvious connections** that qmd cannot surface from a single source
- Required sections in order: identity (one sentence, no heading), `## Role`, `## Relationships`, `## Timeline`, `## Sources`, optional `## Related`
- Strict link format: `[Title](filename.md)` for curated pages, subdir prefixes for source stubs, `../backfill-cache/google-drive/...` for Drive (the `../` is required and is a common bug)
- Reading discipline: read 3-10 representative source bodies; if you only read frontmatter and write prose, you're hallucinating
- Output `<new-entities>` block at end (empty is fine)
- Append a row to `LOG.md`; update `INDEX.md` if creating a new page

The "is this entity worth curating?" decision is also delegated to the agent for the cases the deterministic gate can't catch (e.g., automated-sender domains the regex filters miss, opaque billing IDs that look like ordinary folder names). The agent responds with an explanation + empty `<new-entities>` block when skipping; the skip is logged for audit.

---

## Database schema (full)

| Table | Purpose | Key |
|-------|---------|-----|
| `backfill_state` | Per-plugin cursor; reused as a generic atomic-lock table for curation pending rows | `plugin_id` |
| `source_entities` | (entity, source) pairs and processing state | `(source_path, entity_type, entity_value)` |
| `body_extraction_log` | Tracks which stubs have had body extraction run | `(source_path, workspace_id)` |

All tables are scoped by `workspace_id` (multi-tenant ready).

---

## API endpoints (full)

All routes mounted at `/api/backfill/*`. Auth via `inbox_session` cookie.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/:pluginId` | Run raw backfill for one plugin |
| POST | `/` | Run raw backfill for all plugins |
| POST | `/extract-bodies?source=X&limit=N` | Bulk body extraction for one plugin |
| POST | `/extract-entities?source=X` | Bulk entity extraction for one plugin |
| POST | `/curate-entity/next` | Curate the top-priority unprocessed entity |
| POST | `/curate-entity?type=X&value=Y` | Curate a specific entity |
| POST | `/record-discovered` | Insert entities from a `<new-entities>` block |
| POST | `/curate` | (legacy) per-source curation — disabled |

Get a session token for `curl` testing:
```bash
psql $DATABASE_URL -t -c "SELECT token FROM auth_sessions LIMIT 1"
```

---

## Configuration

### Environment variables

| Var | Default | Stage | Purpose |
|-----|---------|-------|---------|
| `DATABASE_URL` | (required) | all | Postgres connection string |
| `OLLAMA_HOST` | `http://localhost:11434` | 2 | Ollama daemon |
| `OLLAMA_MODEL` | `qwen3.5:4b` | 2 | Body extraction model |
| `CURATION_MODEL` | `claude-haiku-4-5-20251001` | 4 | Model used for curation sessions |
| `ANTHROPIC_API_KEY` | — | 4 | Excluded from agent env (sessions use the user's Claude subscription) |

### In-code constants (entity-curator.ts)

| Constant | Default | Purpose |
|----------|---------|---------|
| `MAX_CANDIDATE_CHARS` | 6000 | Cap on candidate page content in prompt |
| `MAX_PARENT_COMPANY_CHARS` | 6000 | Cap on parent-company hint content |
| `MAX_SOURCES_IN_PROMPT` | 30 | Cap on sources fetched per session |
| `MIN_SOURCES_BY_TYPE` | folder/tag: 5; project/product/channel: 3 | Skip thresholds |
| `STALE_LOCK_MS` | 1h (in `curation-session.ts`) | TTL for orphaned pending rows |

### In-code lists (entity-gate.ts)

| Constant | Purpose |
|----------|---------|
| `OPAQUE_ID_PATTERNS` | Regex list — Account #, UUIDs, long opaque IDs, raw URLs, `#12345` ticket refs |
| `PERSONAL_EMAIL_DOMAINS` | 39-domain set — gmail, yahoo, hotmail, etc. |
| `SELF_DOMAINS` | hammies.com, hammiesshorts.com, hammies.co |
| `TAG_NOISE_PREFIXES` | `category_`, `smartlead/`, `auto-` |

### In-code lists (entity-curator.ts)

| Constant | Purpose |
|----------|---------|
| `AMBIGUOUS_DOMAINS` | Domains that match dozens of unrelated pages — `shopify.com`, `instagram.com`, `klaviyo.com`, etc. Agent forced to use INDEX.md instead of slug match. |

---

## Cost & performance

The dominant cost is Stage 4 (Claude sessions). The other stages run on Postgres + local Ollama.

### Knobs (largest savings first)

1. **`CURATION_MODEL`** — Haiku 4.5 default vs Sonnet recovers ~5× on output cost and frees the Sonnet weekly quota entirely.
2. **`MAX_CANDIDATE_CHARS` / `MAX_PARENT_COMPANY_CHARS`** — canonical pages like `distribution-management.md` (1400+ lines) were repeated on every contact session before the cap. Lowering further saves linearly.
3. **`MAX_SOURCES_IN_PROMPT`** — also caps the per-session source fetch so the queue progresses incrementally (a 100-source entity becomes 4 sessions of 25 sources, not 1 session that reads 10 of 100).
4. **`MIN_SOURCES_BY_TYPE`** — sub-threshold entities skip with zero tokens.
5. **`gateEntity` patterns** — every regex/domain added to the gate is a class of zero-token skip.
6. **Pause file** (`/tmp/curate.pause`) — operational; halt during quota crunch.

### Observability

Throughput sample query:
```sql
SELECT
  (SELECT count(*) FROM body_extraction_log WHERE extracted_at > now() - interval '10 minutes') AS extracted_10m,
  (SELECT count(*) FROM source_entities WHERE source_added_at::timestamptz > now() - interval '10 minutes') AS entities_10m,
  (SELECT count(*) FROM source_entities WHERE processed_for_entity = 0) AS queue;
```

Top of the queue (what's about to be curated):
```sql
SELECT entity_type, entity_value, COUNT(*) AS sources
FROM source_entities
WHERE processed_for_entity = 0
GROUP BY entity_type, entity_value
ORDER BY
  CASE entity_type
    WHEN 'domain' THEN 0 WHEN 'company' THEN 1 WHEN 'person' THEN 2
    WHEN 'project' THEN 3 WHEN 'product' THEN 4 WHEN 'folder' THEN 5
    ELSE 6 END,
  COUNT(*) DESC
LIMIT 20;
```

LOG.md is the audit trail. Recent skips:
```bash
grep "| skipped |" packages/agent/context/LOG.md | tail -20
```

---

## Operator playbook

### Common tasks

**Pause the curate loop (preserve state)**
```bash
touch /tmp/curate.pause
# resume:
rm /tmp/curate.pause
```

**Restart the loops** (after server restart or code change to inbox)
```bash
kill $(cat /tmp/body-extract.pid /tmp/curate.pid)
nohup /tmp/body-extract-loop.sh > /tmp/body-extract.log 2>&1 & echo $! > /tmp/body-extract.pid
nohup /tmp/curate-loop.sh > /tmp/curate.log 2>&1 & echo $! > /tmp/curate.pid
```

**Force-re-curate a specific entity**
```bash
DATABASE_URL=$(grep DATABASE_URL packages/inbox/.env | cut -d= -f2-)
psql "$DATABASE_URL" -c "UPDATE source_entities SET processed_for_entity = 0 WHERE entity_type = 'company' AND entity_value = 'invenco';"
TOKEN=$(psql "$DATABASE_URL" -t -c "SELECT token FROM auth_sessions LIMIT 1" | xargs)
curl -s -X POST "http://localhost:3002/api/backfill/curate-entity?type=company&value=invenco" \
  -b "inbox_session=$TOKEN" -H 'Origin: http://localhost:5175'
```

**Purge stale entity rows** (after manual page deletion)
```sql
DELETE FROM source_entities WHERE entity_value IN ('foo-old', 'bar-old');
```

**Clear orphaned pending locks** (after server crash mid-session)
```sql
DELETE FROM backfill_state WHERE plugin_id LIKE 'entity-curation:%' AND last_run_at < now() - interval '1 hour';
```

### CLI tools

[`scripts/consolidate-entity.sh`](../scripts/consolidate-entity.sh) — operator tool for context cleanup:

```bash
./scripts/consolidate-entity.sh merge --from old-page.md --into canonical.md
./scripts/consolidate-entity.sh rename old.md new.md
./scripts/consolidate-entity.sh delete noise.md
./scripts/consolidate-entity.sh audit
```

Each operation:
- Redirects all in-context references via sed
- Updates `INDEX.md`
- Appends a row to `LOG.md`
- Purges matching `source_entities` rows
- Supports `--dry-run` and `--no-purge`

The `audit` subcommand surfaces TLD-suffix files, stub-like pages, missing-file INDEX entries, and merge candidates.

---

## Known gaps

- **Alias canonicalization is shallow.** `pam watson` and `pam.watson@ecomcpa.com` produce two distinct queue entries; the agent papers over this at curation time but each variant burns its own session. Future work: alias map / periodic dedup pass.
- **`tag` entities rarely produce useful pages.** Currently filtered out at the gate. Most plugins also stopped emitting them.
- **Per-source curation is disabled.** The legacy `runCuratedUpdate` path in `context-backfill-scheduler.ts` is left in place (file still present) but no longer dispatched. Entity curation supersedes it.
- **No structured "this candidate is wrong" feedback loop.** When the agent decides the auto-found candidate is the wrong page, that decision isn't surfaced for review — only the resulting LOG.md row.

---

## File map

| File | Stage | Role |
|------|-------|------|
| [`src/types/plugin.ts`](../src/types/plugin.ts) | — | `Plugin`, `PluginItem`, `Entity` interfaces |
| [`server/routes/backfill.ts`](../server/routes/backfill.ts) | 1, 2, 3, 4 | All HTTP endpoints |
| [`server/lib/context-backfill-scheduler.ts`](../server/lib/context-backfill-scheduler.ts) | 1 | 30-min scheduler + `runRawBackfill` |
| [`server/lib/body-extractor.ts`](../server/lib/body-extractor.ts) | 2 | Ollama-based body cleanup + entity hint |
| [`server/lib/entity-extractor.ts`](../server/lib/entity-extractor.ts) | 3 | `extractEntitiesForItem`, queue read APIs, canonicalization |
| [`server/lib/entity-curator.ts`](../server/lib/entity-curator.ts) | 4 | Candidate lookup, prompt assembly, dispatch |
| [`server/lib/entity-gate.ts`](../server/lib/entity-gate.ts) | 4 | Pre-curation deterministic skip |
| [`server/lib/curation-session.ts`](../server/lib/curation-session.ts) | 4 | Atomic lock + Agent SDK dispatch + stale-lock TTL |
| [`server/db/migrations/006_backfill_state.sql`](../server/db/migrations/006_backfill_state.sql) | — | Schema |
| [`server/db/migrations/007_source_entities.sql`](../server/db/migrations/007_source_entities.sql) | — | Schema |
| [`server/db/migrations/008_body_extraction_log.sql`](../server/db/migrations/008_body_extraction_log.sql) | — | Schema |
| [`scripts/consolidate-entity.sh`](../scripts/consolidate-entity.sh) | 4 (ops) | Operator cleanup CLI |
| [`packages/agent/plugins/workspace-filters.ts`](../../agent/plugins/workspace-filters.ts) | 3 | Shared noise filters |
| [`packages/agent/context/SCHEMAS.md`](../../agent/context/SCHEMAS.md) | 4 | Required structure for curated pages |
| [`packages/agent/context/_template.md`](../../agent/context/_template.md) | 4 | Template for new pages |
