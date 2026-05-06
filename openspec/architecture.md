# OpenSpec Architecture Index

This file is the entry point for the living-spec system at `openspec/specs/`. Every domain spec is the contract for its slice of the codebase: the inbox could be re-implemented from scratch by reading the specs alone, with the code as a verification check rather than a source of truth. When code and spec disagree, the spec is wrong until updated — not the code.

## How this folder is organized

- **`openspec/architecture.md`** (this file) — the index, principles, and cross-cutting conventions.
- **`openspec/specs/<domain>/spec.md`** — one folder per domain. Each spec has fixed sections: `Purpose`, `Context`, `Requirements`, `Technical Notes`, `History`.
- **`openspec/changes/<change-name>/`** *(future, not yet populated)* — staging area for in-flight proposals. Approved changes merge into the relevant `specs/<domain>/spec.md` and the change folder is archived.

The standalone `docs/` folder remains the project's general engineering documentation (architecture overview, governance, CI tiers, coverage map). Specs in `openspec/specs/` are narrower and stricter — they are contracts; the `docs/` files are guides.

## Principles

These mirror and tighten the principles already declared in [`docs/architecture.md`](../docs/architecture.md). Every spec in this tree is written assuming them.

1. **Spec first.** Behavior, architecture, data contracts, UI flow, and verification expectations are written into the spec before the code changes that affect them.
2. **Code reality, not historical docs.** When writing a new spec for an existing subsystem, read the code first. Older `docs/` notes are a source of leads, not truth — the spec must match what runs.
3. **Sections are fixed, not free-form.** `Purpose / Context / Requirements / Technical Notes / History`. Requirements are headed scenarios in **WHEN / THEN / AND / WHY** form. The heading text *is* the reference key — there are no `REQ-N` IDs.
4. **Why over what.** `Context` and `**Why:**` lines exist to record load-bearing reasons. A spec that only restates what the code does adds zero value; a spec that records *why* a particular shape was chosen prevents the next agent from re-litigating it.
5. **One owning domain per file.** Every source file has exactly one owning spec. Shared utilities are owned by app shell, UI, API, or verification specs. Multi-owner files are a smell — split them.
6. **Effects at the edges.** Reducers, selectors, schema transforms, and pure helpers have specs that say "no I/O." Routes, hooks-with-side-effects, and SDK adapters have specs that name the I/O explicitly.

## Domain map

Specs already in `openspec/specs/`:

| Spec | Owns |
|---|---|
| [`database`](specs/database/spec.md) | Postgres pool, transactional helpers, migration runner, current schema surface |
| [`auth-and-sessions`](specs/auth-and-sessions/spec.md) | Google ID-token verification, browser session cookie, `/api/*` auth middleware, CSRF origin check |
| [`credentials-vault`](specs/credentials-vault/spec.md) | AES-256-GCM vault, user/workspace credential resolution, OAuth connect/callback, agent env stripping |
| [`workspace`](specs/workspace/spec.md) | Workspace registration, membership/roles, active-workspace cookie resolution, admin guard |
| [`session-streaming`](specs/session-streaming/spec.md) | Multiplexed WebSocket protocol, broadcast buffer, recovery coordinator, reconnect/keepalive |
| [`email-sanitizer`](specs/email-sanitizer/spec.md) | Quote/signature/disclaimer stripping for inbound email bodies (Gmail plugin) |

Specs not yet written (planned, in roughly the order they will be added):

- `session-manager` — Agent SDK lifecycle, JSONL parsing, sequence assignment, optimistic prompts, `runningQueries`
- `session-files` — per-session input/output directories under the workspace, file uploads
- `session-instructions` — per-session and per-workspace instruction overlays
- `plugin-system` — plugin loading, lifecycle, REST mounting, panel registry, sidebar, watcher
- `context-system` — body extraction, entity extraction, entity curation, backfill scheduler, source entities
- `integrations` — integration registry (auth type, scopes, token URLs), OAuth provider config
- `webhooks` — third-party webhook ingress, signature verification
- `preferences` — per-user key/value preferences API
- `health-rate-limit-logging` — health checks, rate limiter, structured logger, request context
- `artifacts-and-render-tools` — artifact store, render-output tool, custom XML rendering
- `title-generator` — auto-titling for sessions
- `credential-proxy` — outbound credential proxy and CA injection
- `core-plugin` — built-in core plugin (sessions, settings panels)
- `gmail-plugin` — gmail plugin app (excluding email-sanitizer, which has its own spec)
- `navigation` — PanelStack navigation, 2D grid model, scroll persistence
- `session-views-controller` — transcript/composer/visibility logic for sessions UI
- `shared-ui-components` — shared `@hammies/frontend` consumption rules, layout primitives, list views
- `rich-text-editor` — composer rich text editor
- `theming` — theming surface
- `data-table-list-views` — list/table presenters and filter shapes
- `api-client` — typed API client, error handling, query keys
- `user-and-types` — top-level user types, shared frontend type definitions

Each planned spec replaces or supersedes the corresponding `docs/*.md` (where one exists) as the contract — the `docs/` file may stay as a guide but the spec is what governs.

## Spec template

```markdown
# <Domain Name>

## Purpose
One paragraph: what this subsystem is for, who depends on it, what would break if it disappeared.

## Context
Why the design is the way it is. Constraints, prior incidents, alternatives ruled out, scope boundaries (what is NOT in this spec). Use subheadings.

## Requirements

### <Requirement heading — short imperative phrase>

#### Scenario: <one-line behavior summary>
- **WHEN** <triggering condition>
- **THEN** <observable outcome>
- **AND** <additional outcome>
- **WHY:** <load-bearing reason — only when non-obvious>

(Repeat scenarios per requirement; repeat requirements per domain.)

## Technical Notes

| Concern | Location |
|---|---|
| <what> | [path:line](../../path) |

## History
Bullet list of load-bearing decisions, prior incidents, and migrations that shaped the current spec. NOT a changelog.
```

## Authoring rules

- **Read the code first.** Pull the actual file paths and line numbers into the Technical Notes table from `git ls-files` and direct reads, not from the older `docs/` content.
- **Keep scenarios observable.** WHEN/THEN should describe inputs and outputs at a layer the spec's owning domain controls — not inner implementation details.
- **Annotate the load-bearing decisions with `WHY`.** A scenario without WHY is fine when the behavior is mechanical (e.g. "returns rowCount"); a scenario with surprising behavior or a defensive check needs WHY or a future agent will revert it.
- **No REQ-N IDs.** Heading text is the reference key. If a requirement needs to be cross-referenced, link to the heading anchor.
- **One file per spec.** A domain large enough to need multiple files is two domains.
- **Drop stale references.** When the code changes a path, table row, or constant referenced in the spec, update the spec in the same commit. Coverage tooling will eventually enforce this — for now, do it by hand.

## Verification

`npm run docs:coverage` runs two checks:

1. The legacy `docs/documentation-coverage.md` ownership map — every tracked file must be claimed by some doc. This is the build-failing check.
2. The OpenSpec walker — globs `openspec/specs/**/spec.md`, parses Technical Notes link targets, and reports orphans (source files no spec references) and multi-owner files (split-domain smell). During the spec sweep these are warnings; once every domain has a spec the orphan check graduates to a hard failure.

Stale references — a Technical Notes link pointing at a path that no longer exists — always fail the build. Update the spec in the same commit that moves or deletes the code.

## Change lifecycle

In-flight proposals live at `openspec/changes/<change-name>/proposal.md`. When the change merges:

```
npx tsx scripts/archive-proposal.ts <change-name>
```

The script reads the folder's last commit, prepends `Archived-At: <sha>` and `Archived-On: <date>` to the proposal frontmatter, and moves the folder into `openspec/changes/archive/`. The archive is the durable record of *why* the spec looks the way it does today; the spec itself only carries the load-bearing decisions in its `History` section.

## What this is NOT

- **Not a replacement for `CLAUDE.md`.** Engineering principles (spec-first, derived state, effects at the edges, completion checklist), React design patterns, and dev workflow live in `CLAUDE.md` files at the workspace and package roots. Specs describe *what each domain does*; `CLAUDE.md` describes *how we work*.
- **Not auto-generated.** spec-gen drafts may bootstrap a domain, but every committed `spec.md` is hand-edited against the current code. Drafts are a starting point, never the truth.
