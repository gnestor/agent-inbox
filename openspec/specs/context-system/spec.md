# Context System

## Purpose

The pipeline that turns raw plugin items (emails, tasks, tickets, channels) into a curated [workspace](../workspace/spec.md) knowledge base under `${workspacePath}/context/*.md`. Four stages: (1) raw backfill writes one stub per item via `plugin.itemToContext`; (2) seed-entity extraction pulls structured entities from the stub via `plugin.extractEntities` (or a fallback frontmatter scan); (3) body extraction calls a local Ollama model on item bodies for the named people/companies/products that don't appear in headers; (4) entity curation dispatches one Claude session per entity to fold its unprocessed sources into a curated `.md` page. A 30-minute scheduler drives stage 1; a bash loop polling `/api/backfill/curate-entity/next` drives stage 4.

## Context

### Why the pipeline is staged, not a single agent pass
Each stage has a distinct cost profile: stage 1 is filesystem I/O, stage 2 is regex + plugin code, stage 3 is local-GPU inference, stage 4 is Claude API tokens. Running them as one pass would force the slowest tier (Claude) to wait on the fastest (filesystem) and would put noise (raw stubs) into the LLM's context. Staging lets each tier run at its natural cadence — raw backfill every 30 min, body extraction in a bash loop, entity curation when the queue accumulates enough sources to be worth a session.

### Why entity curation is one Claude session per entity, not batched
A "Mac Mini" curation session needs to see every source mentioning Mac Mini and merge them into one canonical page. Batching multiple entities into one session would force the agent to context-switch and tends to produce shallower edits — the prompt is dominated by listing rather than synthesising. One-entity-per-session also gives a clean retry boundary: a failed session leaves only its own pending row, and the next polling tick picks up where the queue is.

### Why a deterministic gate exists upstream of the curator
`gateEntity` is pure code (regex + set-membership) and rejects opaque IDs (`Account #5015911`, UUIDs, raw URLs), personal email-provider domains (`gmail.com`, `yahoo.com`, etc.), and self-references (Hammies' own domains, the workspace owner). Anything the gate rejects costs zero Claude tokens. The agent had been correctly skipping these in past sessions; the gate just precomputes the verdict so the API call is never made. Sources are still marked processed so the queue advances.

### Why body extraction uses Ollama and not Claude
Body extraction reads thousands of email/task bodies and surfaces names that never appear in headers. At Claude prices this would dwarf the curation budget. Ollama (`qwen3.5:9b` by default) runs locally, has unlimited tokens, and is good enough for "list the proper-noun people, companies, products, and projects in this body". The trade-off is that the model occasionally hallucinates noise — handled by `isNoiseEntity` (promo subdomains, `noreply@` locals, ubiquitous platform names like "gmail"/"shopify").

### Why curation sessions skip the `sessions` DB table
Curation sessions are background work, not user-facing — surfacing them in the inbox session list would clutter it with dozens of "curate person:..." rows per cycle. They run with `skipDbRecord=true` in `session-manager.startSession`, but they DO produce real JSONL files (in `${workspacePath}/context/` as their CWD) so the Agent SDK transcript still exists for debugging.

### Why curation runs on Haiku 4.5 by default
Curation is structured tool work (Read + Edit + Glob + Grep) without much creative reasoning required. Haiku 4.5 handles it fine and recovers ~5× on the Sonnet weekly quota for the user's subscription. Override via `CURATION_MODEL` env when investigating curation quality regressions. The pricing trade-off is documented inline in `curation-session.ts`.

### Why pending rows have a stale-lock TTL
A server crash mid-curation leaves a pending `backfill_state` row claiming the lock. Without a TTL, that entity becomes permanently stuck. `STALE_LOCK_MS = 60 * 60 * 1000` (1h) lets the next scheduler pass reclaim the row — long enough that a real in-flight session won't be stomped on, short enough that a crashed session is retryable within an hour.

### Why per-source curation (legacy) is disabled
An older path called `runBackgroundCurationSession` per source — once for every email/task. The entity-curator path replaced it: instead of one session per source, one session per entity (which sees all unprocessed sources mentioning it). Per-source curation is left commented-out in the scheduler, not deleted, in case the entity flow is ever rolled back.

### Why prompt source lists are double-capped
The DB query for `unprocessedSourcesForEntity` already limits to 100 sources. The curator caps a second time at `MAX_SOURCES_IN_PROMPT = 30` so the agent doesn't waste tokens scanning a 100-line filename list it cannot meaningfully process in one session. Per-entity-type minimums (`folder: 5, tag: 5, project: 3, product: 3, channel: 3`) prevent dispatch when the sample is too small to produce a useful page.

### What is NOT in scope
- The plugin interface — `query()`, `itemToContext()`, `extractEntities()`, `backfillDir()` — owned by `plugin-system`.
- The session lifecycle for the dispatched curation jobs → `session-manager` (specifically `skipDbRecord` / `onEnd`).
- The HTTP rate limit on `/api/backfill/*` → `health-rate-limit-logging`.
- The `<attached_context>` payload format used by interactive sessions → `session-manager`.

## Requirements

### Pipeline stages

#### Scenario: Stage 1 — raw backfill writes one stub per item
- **WHEN** `runBackfill(plugin, ctx)` runs
- **THEN** the plugin's `query()` enumerates source items and `itemToContext(item)` produces a stub `.md` written under `${workspacePath}/context/${plugin.backfillDir(item)}/${stubName}.md`.
- **AND** stubs include frontmatter that downstream stages can scan for entities.

#### Scenario: Stage 2 — seed-entity extraction prefers plugin override, falls back to stub scan
- **WHEN** the post-backfill step runs for an item
- **THEN** `plugin.extractEntities(item)` is called if defined; otherwise `fallbackFromStub(stubPath)` scans the stub's frontmatter and body for emails/names.
- **AND** entities are canonicalised via `canonicalize(type, value)` — emails lowercased, names/folders slugified — before insert into `source_entities`.

#### Scenario: Stage 3 — body extraction via Ollama with noise filter
- **WHEN** `/api/backfill/extract-bodies` runs (or the bash loop driver)
- **THEN** each unprocessed item's body is sent to Ollama (`OLLAMA_HOST`/`OLLAMA_MODEL`, defaults `http://localhost:11434` and `qwen3.5:9b`) with a structured prompt asking for proper-noun people, companies, products, projects.
- **AND** `isNoiseEntity` rejects promo-subdomain domains, `noreply@`-style locals, and ubiquitous platform names (`gmail`, `google`, `shopify`, `klaviyo`, `ups`, `usps`, `fedex`, etc.) before insert.

#### Scenario: Stage 4 — entity curation dispatches one Claude session per entity
- **WHEN** the bash loop polls `POST /api/backfill/curate-entity/next`
- **THEN** `topUnprocessedEntities` returns the top entity by source-count, gated through `gateEntity`; if not skipped, `unprocessedSourcesForEntity` collects up to 100 sources; the curator builds a prompt capped at `MAX_SOURCES_IN_PROMPT = 30` source filenames and `MAX_CANDIDATE_CHARS = 6000` of candidate-page content (and `MAX_PARENT_COMPANY_CHARS = 6000` for the parent company page when a person rolls up to a company).
- **AND** the session is launched via `runBackgroundCurationSession` with `skipDbRecord=true`, CWD = `${workspacePath}/context`, and the default `CURATION_MODEL` (`claude-haiku-4-5-20251001`).

#### Scenario: Stage 4 — `MIN_SOURCES_BY_TYPE` skips low-yield entities
- **WHEN** an entity's unprocessed-source count is below the per-type minimum (`folder: 5`, `tag: 5`, `project: 3`, `product: 3`, `channel: 3`)
- **THEN** the curator returns `{ skipped: "below-min-sources" }` and does not dispatch a session.
- **AND** sources for that entity remain unprocessed; the next pass with more accumulated sources will dispatch.

### Gate

#### Scenario: Opaque IDs are rejected without a Claude call
- **WHEN** `gateEntity` sees a value matching `^account\s*#\s*\d+$`, a UUID, a raw URL (`^[a-z]+://`), `^#\d+$`, or a long `[a-zA-Z0-9_-]{20,}` opaque token
- **THEN** the gate returns a skip verdict and the entity is marked processed without dispatch.

#### Scenario: Personal email-provider domains are rejected
- **WHEN** the entity is `domain:gmail.com` (or any of the personal-provider set: yahoo, hotmail, outlook, aol, icloud, me, mac, live, msn, comcast, verizon, att, sbcglobal, ymail)
- **THEN** the gate skips — the matching `person:<email>` entity is the canonical home, not the provider domain.

#### Scenario: Self-references are rejected
- **WHEN** the entity is Hammies' own domain or the workspace owner's email
- **THEN** the gate skips — usually filtered at extraction, but the discovered-entities loop can re-emit them.

### Background session lifecycle

#### Scenario: `runBackgroundCurationSession` claims the pending row atomically
- **WHEN** the helper is called with a `pendingKey` (e.g. `entity-curation:person:foo@example.com`)
- **THEN** it writes a pending row to `backfill_state` BEFORE calling `startSession` — concurrent calls cannot both dispatch.
- **AND** if a row already exists with `last_run_at` newer than `STALE_LOCK_MS = 60 * 60 * 1000`, the helper returns `{ skipped: "locked" }`.
- **AND** if the existing row's lock is stale (older than `STALE_LOCK_MS`), the helper clears it and proceeds.

#### Scenario: `onComplete` fires exactly once at end-of-stream
- **WHEN** the curation session's message loop finishes successfully
- **THEN** the helper invokes `onComplete()` (which marks sources processed, inserts discovered entities, rolls up persons to domains).
- **AND** if the session errors before completion, the pending row remains with its current `last_run_at`; the stale-lock TTL is the only recovery path.

#### Scenario: Curation sessions run with CWD = `${workspacePath}/context`
- **WHEN** any curation session is launched
- **THEN** `getCurationCwd(workspacePath)` returns `join(workspacePath, "context")` and that path is passed as the SDK's `cwd`.
- **AND** the SDK's JSONL transcript ends up in `~/.claude/projects/<encoded-context-path>/<sessionId>.jsonl`, separate from interactive sessions.

#### Scenario: Curation sessions skip `sessions` DB rows
- **WHEN** `startSession` is called for curation
- **THEN** `skipDbRecord: true` is passed so the inbox session list does not include curation sessions.

### Scheduler

#### Scenario: Scheduler runs raw backfill every 30 minutes, single-process
- **WHEN** the scheduler tick fires
- **THEN** `runContextBackfill(workspacePath, workspaceId)` runs raw indexing for every plugin with `query()`+`itemToContext()`.
- **AND** if the previous tick is still running, the new tick is skipped (`isRunning` guard).
- **AND** per-source curation is no longer dispatched from the scheduler — entity-curation is the active path, driven externally by a bash loop.

### Workspace context plumbing

#### Scenario: `buildPluginContext` injects credentials lazily per integration
- **WHEN** a route calls `buildPluginContext(c)`
- **THEN** the returned `PluginContext.getCredential(integration)` reads from `vault` per-user, refreshing Google tokens via `refreshGoogleToken` for the `"google"` integration; other integrations return their stored refresh token directly.

#### Scenario: `requireAdmin` enforces admin role on workspace-mutating routes
- **WHEN** a route handler imports `requireAdmin` from `workspace-context`
- **THEN** the helper throws `HTTPException(403, "Admin access required")` if the active workspace's role isn't `"admin"`.

### REST surface

#### Scenario: Backfill routes drive each pipeline stage
- **WHEN** the bash loop or the UI calls into `/api/backfill/*`
- **THEN** the available routes are: `POST /:pluginId` (raw backfill), `POST /:pluginId/re-render` (re-run `itemToContext` without re-querying), `POST /extract-entities`, `POST /extract-bodies`, `POST /curate-entity/next` (claim and curate one entity), `POST /curate-entity` (curate a specific entity), `POST /record-discovered` (insert discovered entities mid-session), `POST /curate` (legacy per-source path, retained for rollback).

### UI surface

#### Scenario: `ContextPanel` renders curated context for a focused entity
- **WHEN** an inbox item is opened with attached `InboxContextData`
- **THEN** the panel renders the entity header (icon + role + company), curated `contextPages`, `relatedThreads`, `relatedTasks`, and a `summary` — accordion sections default-open when non-empty.

## Technical Notes

| Concern | Location |
|---|---|
| Stage 1 — raw backfill route + `runBackfill` | [server/routes/backfill.ts](../../../server/routes/backfill.ts) |
| Stage 2 — seed entity extraction + canonicalisation | [server/lib/entity-extractor.ts](../../../server/lib/entity-extractor.ts) |
| Stage 3 — body extraction via Ollama + noise filter | [server/lib/body-extractor.ts](../../../server/lib/body-extractor.ts) |
| Stage 4 — entity curator (one session per entity) | [server/lib/entity-curator.ts](../../../server/lib/entity-curator.ts) |
| Pre-curation deterministic gate | [server/lib/entity-gate.ts](../../../server/lib/entity-gate.ts) |
| Shared background-curation lifecycle (claim, TTL, onComplete) | [server/lib/curation-session.ts](../../../server/lib/curation-session.ts) |
| 30-minute scheduler driver | [server/lib/context-backfill-scheduler.ts](../../../server/lib/context-backfill-scheduler.ts) |
| Per-request `PluginContext` builder + Google token refresh | [server/lib/plugin-context.ts](../../../server/lib/plugin-context.ts) |
| Workspace context bindings + `requireAdmin` | `server/lib/workspace-context.ts` |
| Frontend curated-context panel | [src/components/session/ContextPanel.tsx](../../../src/components/session/ContextPanel.tsx) |
| Gate test coverage | [server/lib/__tests__/entity-gate.test.ts](../../../server/lib/__tests__/entity-gate.test.ts) |
| Attached-context inlining test (boundary with session-manager) | [server/lib/__tests__/attached-context.test.ts](../../../server/lib/__tests__/attached-context.test.ts) |
| Migration that introduced `backfill_state` | `server/db/migrations/006_backfill_state.sql` |
| Bash drivers | [scripts/body-extract-loop.sh](../../../scripts/body-extract-loop.sh), [scripts/consolidate-entity.sh](../../../scripts/consolidate-entity.sh) |

## History

- Per-source curation (one session per email/task) was the original path; replaced by per-entity curation after the per-source flow produced shallow, scattered pages — the agent had no view of "all sources mentioning Mac Mini" in any one session.
- `entity-gate.ts` was extracted from the curator after a quarter where ~30% of dispatched sessions were the agent saying "this is just an account number" or "this is gmail.com, skip" and quitting — the gate moved that verdict to zero-cost regex.
- Curation default model was switched from Sonnet to Haiku 4.5 after a Sonnet-weekly-quota exhaustion incident; Haiku 4.5 produced indistinguishable results on the Edit-heavy curation workload.
- `MAX_CANDIDATE_CHARS` was added after a single 2000-line canonical page started dominating per-session input tokens. The cap is intentionally generous (6000 chars) and the agent can `Read` for more if needed.
- `MIN_SOURCES_BY_TYPE` was added after the queue spent a full afternoon dispatching `tag:foo` curations with one source each, producing one-line pages.
- Body extraction moved to Ollama after a cost analysis showed body-extraction Claude calls would have been ~70% of the context-system budget; local inference is "free" modulo GPU time.
