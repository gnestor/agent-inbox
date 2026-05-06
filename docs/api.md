# API And Persistence

This doc owns the Hono API boundary, API client, database schema, and migrations.

## Context

The API server is the boundary between browser code, credentials, workspace files, plugins, the database, and the Claude Agent SDK. Keeping this boundary explicit prevents browser code from learning about server-only details and keeps validation close to external input.

## Spec

### Boundaries

- `server/index.ts` composes middleware, routes, WebSocket handling, and startup concerns.
- `server/routes/*` owns HTTP shape: parameters, auth requirements, response serialization, and route-level errors.
- `server/lib/*` owns domain logic used by routes.
- `server/db/*` owns connection pooling, schema helpers, and migrations.
- `src/api/client.ts` is the browser-side typed client. Components should use hooks/controllers over raw `fetch` where possible.

### Route Rules

- Validate all state-changing requests before mutating database, workspace, credentials, or session state.
- Return JSON from API routes.
- Use shared auth/CSRF helpers rather than ad hoc cookie parsing.
- Keep route handlers thin enough that behavior can be tested through server libs or route tests.
- Do not expose secrets, OAuth refresh tokens, vault material, or local filesystem details to browser responses.

### Persistence Rules

- Database schema changes require a migration under `server/db/migrations/`.
- Migrations must be append-only; do not edit a migration that may already have run outside a throwaway local database.
- Schema helper changes in `server/db/schema.ts` must match migrations.
- Tests that depend on database shape should use the e2e integration setup rather than hidden local state.

## History

| Date | Commit | Change |
|------|--------|--------|
| 2026-04-29 | `5e413d6` | Added API and persistence ownership spec. |
