# Database

## Purpose

Provide a single Postgres connection pool, transactional helpers, and a forward-only migration runner for all server-side persistence in the inbox. Every server module that needs durable state — sessions, auth, workspaces, credentials, plugin context, body extraction logs — goes through this layer. There is no second database, no in-memory shadow, and no SQLite fallback.

## Context

### Why Postgres-only
The app started on SQLite (`better-sqlite3`) and migrated to Postgres. The migration is complete: every runtime query goes through `pg.Pool` against `DATABASE_URL`. The legacy file `server/db/schema.ts` still imports `better-sqlite3` and references a `data/inbox.db` path — it has **zero importers** in the current codebase and is dead. Migration `001_initial_schema.sql` carries the forward-port of its DDL; the file itself can be deleted.

### Why a hand-rolled migration list, not a tool
Migrations are an append-only array of `.sql` filenames in `pool.ts`. Each file is run on every `initializeDatabase()` call; every statement uses `IF NOT EXISTS` / `IF EXISTS` / column-presence guards (`information_schema.columns`) so re-running is a no-op. There is no migrations table, no version tracking, no down migrations. The trade-off: we cannot reorder or hot-fix a shipped migration — once a file is in the list and running in prod, it must stay idempotent forever.

### Why no server-side cache
Migration `004_drop_api_cache.sql` removed the `api_cache` table. React Query handles caching client-side; the server returns fresh data on every request. Anything that *looks* like server caching (e.g. `backfill_state`, `body_extraction_log`) is **progress tracking**, not result memoization — it lets long-running batch jobs resume, not skip work that's still semantically required.

### Why JSONL for session transcripts
Migration `005_drop_session_messages.sql` removed the `session_messages` table. The Claude Agent SDK writes JSONL files under `~/.claude/projects/`; those files are the canonical transcript and are interchangeable with the Claude Code CLI. Storing a parallel copy in Postgres would create a two-source-of-truth problem.

## Requirements

### Connection pool

#### Scenario: Pool is lazily created from `DATABASE_URL`
- **WHEN** any caller invokes `getPool()` for the first time
- **THEN** a `pg.Pool` is constructed with `max: 10`, `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`.
- **AND** subsequent calls return the same pool instance.

#### Scenario: Missing `DATABASE_URL` fails fast
- **WHEN** `getPool()` is called and `process.env.DATABASE_URL` is unset
- **THEN** a clear error is thrown naming the variable and an example connection string.
- **AND** the pool is NOT memoized — the next call retries.

#### Scenario: `closePool()` releases all clients
- **WHEN** the server shuts down and calls `closePool()`
- **THEN** `pool.end()` is awaited and the cached reference is cleared so the next `getPool()` reconstructs.

### Query helpers

#### Scenario: `query()` returns rows
- **WHEN** `query<T>(sql, params)` is called
- **THEN** it executes on the pool and returns `result.rows` typed as `T[]`.

#### Scenario: `queryOne()` returns first row or undefined
- **WHEN** `queryOne<T>(sql, params)` is called and the result has 0 rows
- **THEN** it returns `undefined` (not `null`).
- **AND** when the result has ≥1 row it returns `rows[0]`.

#### Scenario: `execute()` returns rowCount
- **WHEN** `execute(sql, params)` is called for INSERT/UPDATE/DELETE
- **THEN** it returns `{ rowCount }` with `rowCount: 0` if the driver reports `null`.

#### Scenario: `withTransaction()` commits on success, rolls back on throw
- **WHEN** the callback resolves
- **THEN** `COMMIT` is issued and the client is released.
- **WHEN** the callback throws
- **THEN** `ROLLBACK` is issued, the client is released, and the original error is re-thrown.
- **WHY:** the recovery path of a partial write must never leak a connection back to the pool mid-transaction.

### Migrations

#### Scenario: `initializeDatabase()` runs the migration list in order
- **WHEN** the server boots
- **THEN** every file in the migrations array is read from `server/db/migrations/` and executed in declared order.
- **AND** the array is the source of truth — files added to the directory but not the array are ignored.

#### Scenario: Re-running migrations is a no-op
- **WHEN** `initializeDatabase()` runs against an already-initialized database
- **THEN** every statement succeeds without altering schema or data, because each migration uses idempotent guards (`IF NOT EXISTS`, `IF EXISTS`, `information_schema.columns` checks).
- **WHY:** there is no migration version table; idempotency is the entire correctness story.

#### Scenario: Migration list is append-only
- **WHEN** a schema change is needed
- **THEN** a new numbered file (`NNN_<name>.sql`) is added to `server/db/migrations/` AND appended to the migrations array in `pool.ts`.
- **AND** existing migration files are NEVER edited after they have run in any environment, even to fix typos — corrections ship as a follow-up migration.

### Schema surface

The current schema, after migrations 001–008, is:

| Table | Owning domain | Purpose |
|---|---|---|
| `sessions` | session-manager | Session metadata + `linked_source_type`/`linked_source_id` (legacy `linked_email_*`/`linked_task_id` columns dropped in 003) |
| `users` | auth-and-sessions | Google-authenticated user records |
| `auth_sessions` | auth-and-sessions | Browser session tokens (cookie `inbox_session`) |
| `user_preferences` | preferences | Per-user key/value settings |
| `user_credentials` | credentials-vault | Per-user encrypted OAuth tokens |
| `workspace_credentials` | credentials-vault | Per-workspace shared encrypted tokens |
| `workspaces` | workspace | Workspace registry (id, name, path) |
| `workspace_members` | workspace | (workspace_id, user_email, role) |
| `backfill_state` | context-system | Per-plugin cursor for context backfill resumption |
| `source_entities` | context-system | Entity index for proximity-grouped curation |
| `body_extraction_log` | context-system | Resume marker for bulk body-text entity extraction |

Tables removed by prior migrations and NOT in the current schema: `notion_options` (003), `api_cache` (004), `session_messages` (005).

### Dead code

#### Scenario: `server/db/schema.ts` is unreferenced
- **WHEN** the codebase is grepped for imports of `db/schema` or `./schema` from `server/`
- **THEN** zero results return.
- **AND** the file imports `better-sqlite3`, which is no longer a runtime dependency of the database layer.
- **THEN** this spec records the file as dead and slated for deletion; new work MUST NOT add imports of it.

## Technical Notes

| Concern | Location |
|---|---|
| Pool construction, query helpers, transaction wrapper | [server/db/pool.ts:9-94](../../../server/db/pool.ts) |
| Migration list (source of truth for which files run) | [server/db/pool.ts:71-80](../../../server/db/pool.ts) |
| Migration files | [server/db/migrations/](../../../server/db/migrations/) |
| Dead SQLite schema (slated for deletion) | [server/db/schema.ts](../../../server/db/schema.ts) |
| One-time SQLite→Postgres migration script | [scripts/migrate-sqlite-to-postgres.ts](../../../scripts/migrate-sqlite-to-postgres.ts) |

## History

- Initial Postgres pool + migration runner translated from SQLite (`001_initial_schema.sql`).
- 002: workspaces + workspace_members.
- 003: dropped legacy plugin-specific `linked_*` columns on `sessions` after backfill into `linked_source_type`/`linked_source_id`; dropped `notion_options` (Notion plugin now reads option metadata from the API directly).
- 004: dropped `api_cache` — caching moved fully to React Query client-side.
- 005: dropped `session_messages` — JSONL files under `~/.claude/projects/` are the only authoritative transcript store.
- 006: added `backfill_state` for resumable per-plugin context backfill.
- 007: added `source_entities` to enable entity-grouped curation passes.
- 008: added `body_extraction_log` so the bulk body-extraction pass can resume.
