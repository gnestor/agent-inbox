# API Client

## Purpose

A single typed wrapper over `fetch()` that every React hook uses to talk to the Hono server. Centralizes the `/api` base, the JSON content type, and the "throw `Error(\`API ${status}: ${text}\`)`" failure shape so React Query's error path is uniform across the app.

## Context

### Why one `request()` helper, not per-feature clients
Every endpoint shares the same shape: send/receive JSON, fail on non-2xx, surface the status and body in the error message. Encoding this once means React Query's `onError` can match by string prefix or just surface `err.message`, and component code never branches on raw `Response` objects.

### Why no auth header here
Authentication is a same-origin cookie (`hammies_session`). `fetch()` sends it automatically; the client has nothing to add. `credentials: "same-origin"` is the default for same-origin requests, so we don't set it explicitly.

### 401 → session-expired event
When the server returns 401, `request()` dispatches `window.dispatchEvent(new CustomEvent("session-expired"))` before throwing. `useUserProvider` listens for this event and calls `refresh()`, which re-checks `/api/auth/session` and sets `user: null` if the JWT is gone — causing `AppContent` to unmount the app and show `<LoginPage />`. This ensures that a session expiry (e.g. after a JWT cookie change) surfaces as a re-login prompt rather than cryptic error toasts.

### Why explicit return types via `import("@/types")`
The client is the wire-format boundary. Using `import()` types instead of top-of-file imports keeps the types lazy and prevents accidental runtime imports of types-only modules — important because `@/types` re-exports from many domain folders.

### What is NOT in scope
- Query key conventions, `QueryClient` config, persistence → owned by [`src/lib/queryClient.ts`](../../../src/lib/queryClient.ts) (covered under `shared-ui-components` until promoted) and the React Query layer.
- Plugin-specific endpoints (e.g. Gmail-specific actions) — those live in `plugins/<id>/app/api.ts` and are owned by their plugin spec.

## Requirements

### Single transport helper

#### Scenario: Successful request returns parsed JSON
- **WHEN** `request<T>(path, options?)` is called and the server responds with 2xx
- **THEN** the body is parsed as JSON and typed as `T`.
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

## Technical Notes

| Concern | Location |
|---|---|
| `BASE = "/api"`, `request<T>()` helper, JSON+throw conventions | [src/api/client.ts:1-13](../../../src/api/client.ts#L1-L13) |
| Auth, sessions, plugins, connections, preferences, workspaces, users sections | [src/api/client.ts](../../../src/api/client.ts) |
| `PluginManifest` type | [src/api/client.ts:174-187](../../../src/api/client.ts#L174-L187) |
| Multipart upload helper (bypasses `request()`) | [src/api/client.ts:141-162](../../../src/api/client.ts#L141-L162) |

## History

- Started as one function per route file, then collapsed into a single `client.ts` so React Query setup and tests had one import surface.
- Error shape standardized on `API ${status}: ${text}` after several hooks invented their own message formats and React Query's retry logic couldn't tell auth errors from server errors.
