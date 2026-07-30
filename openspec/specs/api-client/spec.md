# API Client

## Purpose

A single runtime-validated wrapper over `fetch()` that every React hook uses to
talk to the Hono server. It centralizes the `/api` base, JSON content type,
bounded bodies, contract diagnostics, and canonical HTTP errors so an
untrusted response never escapes as a caller-selected type.

## Context

### Why one `request()` helper, not per-feature clients
Every endpoint supplies a Zod response schema to `request()`. The helper
decodes legacy or versioned error envelopes on non-2xx responses and validates
successful payloads before returning them.

### Why no auth header here
Authentication is a same-origin cookie (`hammies_session`). `fetch()` sends it automatically; the client has nothing to add. `credentials: "same-origin"` is the default for same-origin requests, so we don't set it explicitly.

### 401 → session-expired event
When the server returns 401, `request()` dispatches `window.dispatchEvent(new CustomEvent("session-expired"))` before throwing. `useUserProvider` listens for this event and calls `refresh()`, which re-checks `/api/auth/session` and sets `user: null` if the JWT is gone — causing `AppContent` to unmount the app and show `<LoginPage />`. This ensures that a session expiry (e.g. after a JWT cookie change) surfaces as a re-login prompt rather than cryptic error toasts.

### Shared transport schemas
`src/api/contracts.ts` owns reusable user, workspace, session, plugin-item,
widget, integration, cache, and git-status schemas. Endpoint envelopes compose
those primitives in `client.ts`.

### What is NOT in scope
- Query key conventions, `QueryClient` config, persistence → owned by [`src/lib/queryClient.ts`](../../../src/lib/queryClient.ts) (covered under `shared-ui-components` until promoted) and the React Query layer.
- Plugin-specific endpoints (e.g. Gmail-specific actions) — those live in `plugins/<id>/app/api.ts` and are owned by their plugin spec.

## Requirements

### Single transport helper

#### Scenario: Successful request returns parsed JSON
- **WHEN** `request(path, schema, options?)` is called and the server responds with 2xx
- **THEN** the body is parsed and validated by `schema`.
- **AND** `Content-Type: application/json` is set unless the caller overrides headers.

#### Scenario: Non-2xx responses throw with status and body; 401 triggers re-login
- **WHEN** the response status is not OK
- **THEN** the helper reads the body as text and throws `new Error(\`API ${status}: ${text}\`)`.
- **AND** if the status is 401, `window.dispatchEvent(new CustomEvent("session-expired"))` fires before the throw.
- **WHY:** error consumers can still pattern-match on `err.message`; the event lets `useUserProvider` redirect to the sign-in page without any per-hook 401 handling.

#### Scenario: Multipart upload bypasses the helper
- **WHEN** `uploadSessionFile` posts a `FormData`
- **THEN** the call uses `fetch` directly (no `Content-Type` override — browser sets the multipart boundary) but still throws on non-2xx with the same `API ${status}: ${text}` shape.

### Endpoint coverage

The client exposes one function per endpoint, grouped into sections by domain. Each section's call signatures are the contract for the corresponding server route — when the server route changes, the client function in this file changes in the same commit.

#### Scenario: Auth section covers `/api/auth/*`
- **WHEN** the frontend signs in or checks session
- **THEN** `getAuthClientId`, `authCallback`, `getAuthSession`, `logout` cover `/auth/client-id`, `/auth/callback`, `/auth/session`, `/auth/logout`.

#### Scenario: Sessions section covers `/api/sessions/*`
- **WHEN** the frontend manages agent sessions
- **THEN** the `getSessions`, `getSession`, `createSession`, `updateSession`, `resumeSession`, `abortSession`, `archiveSession`, `unarchiveSession`, `answerSessionQuestion`, `attachToSession`, `updateArtifactCode`, `uploadSessionFile`, `getSessionFileUrl`, `getLinkedSession`, `getSessionProjects` functions all live here.
- **AND** `getSessionFileUrl` is the only function that returns a URL string (not a fetched body), so consumers can pass it to `<img src>` / `<a href>` without an extra round trip.

#### Scenario: Plugins section covers `/api/plugins` and `/api/:pluginId/*`
- **WHEN** the frontend lists plugins or queries plugin items
- **THEN** `getPlugins`, `queryPluginItems`, `getPluginItem`, `queryPluginSubItems`, `getFieldOptions`, `getPanelSchemas`, `mutatePluginItem` cover the contract.
- **AND** `PluginManifest` is exported for hooks/components that consume the plugin list.

#### Scenario: Connections, preferences, workspaces, users
- **WHEN** the frontend manages integrations, preferences, workspaces, or user profiles
- **THEN** each section exposes one function per route as named in code (`getConnections`, `disconnectIntegration`, `getConnectUrl`, `getPreferences`, `setPreference`, `getUserProfiles`, `getWorkspaces`, `setActiveWorkspace`, `getWorkspaceDetails`, `renameWorkspace`, `getWorkspaceGitInfo`, `addWorkspaceMember`, `removeWorkspaceMember`, `updateMemberRole`, `getAvailableUsers`).

### Stability of the wire shape

#### Scenario: Server route change requires a same-commit client change
- **WHEN** a server handler's request or response type changes
- **THEN** the corresponding client function's typed signature is updated in the same commit.
- **WHY:** the client is the only typed contract on the wire — drift here breaks every hook that consumes it without a TS error.

#### Scenario: Large session snapshots use a bounded endpoint-specific budget

- **WHEN** `getSession` decodes a transcript larger than the generic 5 MB API
  response limit
- **THEN** it accepts a valid snapshot up to 50 MB
- **AND** all other API requests retain the generic 5 MB limit.

## Technical Notes

| Concern | Location |
|---|---|
| `BASE = "/api"`, schema-required `request()` helper, bounded JSON/error decoding | [src/api/client.ts](../../../src/api/client.ts) |
| Reusable response and persisted-query transport schemas | [src/api/contracts.ts](../../../src/api/contracts.ts) |
| Auth, sessions, plugins, connections, preferences, workspaces, users sections | [src/api/client.ts](../../../src/api/client.ts) |
| `PluginManifest` type | [src/api/client.ts:174-187](../../../src/api/client.ts#L174-L187) |
| Multipart upload helper (bypasses `request()`) | [src/api/client.ts:141-162](../../../src/api/client.ts#L141-L162) |

## History

- Started as one function per route file, then collapsed into a single `client.ts` so React Query setup and tests had one import surface.
- Error shape standardized on `API ${status}: ${text}` after several hooks invented their own message formats and React Query's retry logic couldn't tell auth errors from server errors.
- 2026-07-27: Replaced generic JSON assertions with required runtime schemas
  and canonical contract errors.
- 2026-07-30: Named and explicitly typed response schemas keep Zod inference
  out of the API client hot path; session snapshots retain a bounded 50 MB
  endpoint-specific response budget.
