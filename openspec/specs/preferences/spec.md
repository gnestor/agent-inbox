# Preferences

## Purpose

Provide a per-user key/value store for client-side UI preferences (panel layouts, toggle states, theme choice, sidebar collapse). Values are JSON-encoded scalars or objects; keys are opaque strings owned by their consuming feature. Every preference is scoped to the authenticated user — no global defaults table, no per-workspace override.

## Context

### Why a single bag, not typed columns
Every preference is feature-local. Adding a typed column for each new toggle would require a migration per feature; instead, the API is a write-through bag — the client decides keys, the server stores `JSON.stringify(value)`. The cost is no server-side validation of preference contents; the trade-off is that no preference change ever requires a backend deploy.

### Why optimistic React Query writes
The `usePreference` hook updates the React Query cache immediately and only logs persistence failures. UI controls (toggles, layout sliders) cannot block on a network round-trip. If the PUT fails, the next page load reverts — acceptable because preferences are by definition non-destructive.

### What is NOT in scope
- Workspace or team-shared settings → `workspace` spec.
- Encrypted credentials → `credentials-vault` spec.
- Plugin-defined option storage → owned by each plugin's settings panel.

## Requirements

### Read all preferences

#### Scenario: Authenticated user fetches their bag
- **WHEN** `GET /api/preferences` is called with a valid `inbox_session` cookie
- **THEN** the route returns a single object `{ [key]: value }` covering all rows from `user_preferences` for that email.
- **AND** each `value` is `JSON.parse`d if possible; on parse failure the raw string is returned.
- **WHY:** older rows pre-date the JSON convention and must round-trip; we don't double-encode them.

#### Scenario: Unauthenticated request is rejected
- **WHEN** the cookie is missing or unknown
- **THEN** the route returns `401 { error: "Unauthorized" }` without reading the table.

### Write a single preference

#### Scenario: Valid PUT upserts the row
- **WHEN** `PUT /api/preferences` is called with body `{ key, value }` parsed by `SetPreferenceBody`
- **THEN** the row `(user_email, key)` is inserted or updated with `value = JSON.stringify(value)` and a fresh `updated_at`.
- **AND** the response is `{ ok: true }`.

#### Scenario: Invalid body returns first Zod issue
- **WHEN** the body fails Zod validation
- **THEN** the route returns `400 { error: <first issue message> }` and the row is not written.

### Batch write

#### Scenario: Batch PUT writes inside one transaction
- **WHEN** `PUT /api/preferences/batch` is called with `{ prefs: { [key]: value } }`
- **THEN** all rows are upserted inside a single `withTransaction` callback so partial writes can never persist.
- **AND** if `prefs` is missing or not an object the route returns `400 { error: "Missing prefs" }`.

### Client hook

#### Scenario: `usePreference(key, default)` reads from the React Query bag
- **WHEN** the hook mounts
- **THEN** it reads the `["preferences"]` query (loaded once, `staleTime: Infinity`) and returns `prefs[key]` or `default` if absent.

#### Scenario: Setter writes optimistically
- **WHEN** the returned setter is called
- **THEN** the React Query cache is updated synchronously via `queryClient.setQueryData` and a fire-and-forget PUT is issued.
- **AND** persistence failures are logged via `console.warn` and never thrown to the caller.
- **WHY:** UI controls must not block on the network; preferences are non-destructive.

## Technical Notes

| Concern | Location |
|---|---|
| `/api/preferences` routes (GET, PUT, batch PUT) | [server/routes/preferences.ts](../../../server/routes/preferences.ts) |
| Route mount | [server/index.ts:341](../../../server/index.ts#L341) |
| `SetPreferenceBody` Zod schema | [server/lib/schemas.ts](../../../server/lib/schemas.ts) |
| `user_preferences` table DDL | [server/db/migrations/001_initial_schema.sql](../../../server/db/migrations/001_initial_schema.sql) |
| `usePreference` hook (optimistic writes) | [src/hooks/use-preferences.ts](../../../src/hooks/use-preferences.ts) |
| Server tests | [server/lib/__tests__/preferences.test.ts](../../../server/lib/__tests__/preferences.test.ts) |
| Hook tests | [src/hooks/__tests__/use-preferences.test.tsx](../../../src/hooks/__tests__/use-preferences.test.tsx) |

## History

- Single `user_preferences(user_email, key, value)` table from migration 001 — never split into typed columns.
- JSON encoding was introduced after early rows were stored as raw strings; the read path tolerates both.
- Batch endpoint added so the client can persist a multi-key UI reset (e.g. layout reset) atomically.
