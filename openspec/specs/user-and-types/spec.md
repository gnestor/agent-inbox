# User and Types

## Purpose

Frontend type bedrock and the user/workspace context. `src/types/index.ts` defines the wire shapes the API client emits (`UserProfile`, `Workspace`, `Session`, `Integration`, ...); `src/types/plugin.ts` defines the `Plugin` interface and `FieldDef` schema; `src/types/panels.ts` defines the `WidgetDef` schema for workflow result panels; `src/hooks/use-user.ts` is the single React entry point for "who am I, what [workspace](../workspace/spec.md), what role" with retry-on-network-error semantics.

## Context

### Why types are physically split across three files
`index.ts` is the catch-all for wire shapes consumed by every feature; `plugin.ts` is large enough (≈330 lines, plus extensive JSDoc with examples) that colocating it with the rest would bury the rest; `panels.ts` is the JSON-schema-like widget tree consumed by `inbox-panels.json` workflow files and the agent's structured output renderer. Each file imports the others lazily via `import("./...")` to keep top-level imports small and prevent circular references.

### Why `use-user.ts` is a context, not a React Query hook
Almost every component reads the current user or active workspace, often during initial render. A React Query hook would cause N suspense triggers and a flash before the first `getAuthSession()` resolves; a context populated once at app mount and refreshed on demand keeps `user` synchronously available everywhere. The `switchWorkspace` action invalidates *every* query (`queryClient.invalidateQueries()`) so workspace-scoped caches reload, but the user/workspace state itself is not in React Query.

### Why `refresh()` retries network errors with backoff
The Hono server can be briefly unavailable on dev restart (vite-plugin-node-server, code reloads). A `TypeError` from `fetch()` is the browser's signal for a connection error; the loop retries up to 3× with 1.5 s × attempt backoff so the page doesn't flash to "logged out" during a server bounce. Other errors (4xx/5xx) break out immediately — those are real, not transient.

### Why `PluginItem` is `Record<string, unknown>` plus a typed `id`
Plugins ship arbitrary fields. Forcing every plugin to declare a TS type would either lock the server to one item shape per plugin (rigid) or require generic `Plugin<TItem>` plumbed through every consumer (heavy). The schema-driven UI (`getTitleField` etc.) reads fields by name through the `FieldDef[]`, so callers don't need a typed item — the schema *is* the type at runtime.

### Why `WidgetDef` exists separately from React components
Workflow result panels (`<inbox-result>` XML emitted by the agent) need a deterministic, JSON-serializable description of how to render structured data — declared in `inbox-panels.json` files, not React. The widget union (`prose`, `kv-table`, `data-table`, `badge-row`, `action-buttons`, `json-tree`, ...) is the public contract between agent prompts and the inbox renderer. Adding a widget = adding a discriminant + a renderer; nothing else changes.

### What is NOT in scope
- Backend types (server-side `Session`, `User`, `Workspace`) → owned by their domain specs.
- Query hooks built on these types → covered under their respective specs (`session-views-controller`, `plugin-system`, `core-plugin`).
- Auth flow / cookie shape → `auth-and-sessions` spec.
- Workspace switching mechanics on the server → `workspace` spec.

## Requirements

### Wire-shape types (`src/types/index.ts`)

#### Scenario: `UserProfile`, `Workspace`, `WorkspaceMember` cover identity and membership
- **WHEN** the API client returns data from `/auth/session` or `/workspaces/*`
- **THEN** the consumer types are `UserProfile { name, email, picture? }`, `Workspace { id, name, role: "admin" | "member" }`, `WorkspaceMember { workspace_id, user_email, role, created_at, name, picture? }`.

#### Scenario: `SessionStatus` is a closed string union
- **WHEN** any code branches on a session's status
- **THEN** the union is `"running" | "complete" | "needs_attention" | "errored" | "awaiting_user_input" | "archived"` — no other values are valid.
- **AND** `formatters.sessionStatusLabel/Color/BadgeClass` (in `shared-ui-components`) covers each case.

#### Scenario: `TriggerSource` is an open union with documented core values
- **WHEN** sessions are filtered by trigger source
- **THEN** the type is `"manual" | "inbox" | "webhook" | (string & {})` — the `& {}` keeps autocomplete on the named values without forbidding plugin-defined values.

#### Scenario: `Session` carries optional `hasActiveProcess`
- **WHEN** the session list is rendered
- **THEN** `hasActiveProcess` is true only when the server has an in-memory agent process for this id (set by the session manager, not persisted).
- **WHY:** distinguishes "this session is currently streaming" from "this session is complete but not yet labeled `complete`" for UI affordances.

#### Scenario: `InboxContextData` and `InboxResultData` mirror the agent's structured output
- **WHEN** an agent emits `<inbox-context>` or `<inbox-result>` XML blocks
- **THEN** the parsed payload satisfies these interfaces; specifically `InboxResultAction` is `"draft" | "task" | "context_updated" | "skipped"`, and `pluginId` is set when known so the renderer can dispatch to plugin-specific result UIs.

### Plugin interface (`src/types/plugin.ts`)

#### Scenario: `Plugin` is the single type implemented by every plugin file
- **WHEN** a plugin file exports `default { ... } satisfies Plugin`
- **THEN** the loader can read `id`, `name`, `icon`, optional `emoji`, `components`, `auth`, `hasSkills`, `skillManifest`, plus the methods `query`, `mutate`, `querySubItems`, `getItem`, `routes`, `enrichForContext`, `itemToContext`, `extractEntities`, `curationPrompt`.
- **AND** every method except `id`/`name`/`icon` is optional — skills-only plugins can declare `hasSkills: true` and ship no data methods.

#### Scenario: `FieldDef` combines filter, badge, list-role, and detail-widget configs
- **WHEN** a plugin declares its `fieldSchema`
- **THEN** each `FieldDef { id, label, type, filter?, badge?, listRole?, detailWidget? }` controls everything about how that field appears: filter UI (`filter.filterable`), list badge (`badge.show/labelFn/colorFn`), list role (`title | subtitle | timestamp | hidden`), and detail-view widget override.
- **AND** `id` is a dot-path (e.g. `"author.name"`) so nested fields are addressable.

#### Scenario: `PluginContext` is request-scoped
- **WHEN** plugin methods are called by the server
- **THEN** the optional `ctx: PluginContext` argument carries `userEmail` and `getCredential(integrationId)`; plugins are expected to thread it through any code that needs auth or user identity.

#### Scenario: `PluginComponents` declares string keys, not React components
- **WHEN** a plugin wants custom client rendering
- **THEN** `components.tab/list/detail` are strings (e.g. `"gmail:tab"`) that the client resolves via a static registry of imported React components.
- **WHY:** plugin manifest must be JSON-serializable — the server can't ship React components to the browser.

### Widget schema (`src/types/panels.ts`)

#### Scenario: `WidgetDef` is a discriminated union by `type`
- **WHEN** a panel schema is parsed from `inbox-panels.json` or `Plugin.detailSchema`
- **THEN** each entry matches one of: `prose`, `kv-table`, `data-table`, `badge-row`, `action-buttons`, `json-tree` (and any others listed in the file).
- **AND** all widgets reference data via `field` (dot-path) or `fields[]`; no widget embeds raw HTML or component refs.

#### Scenario: Action buttons map to mutations, not arbitrary handlers
- **WHEN** a `action-buttons` widget renders
- **THEN** clicking a button calls the source plugin's `mutate(id, action.mutation, payload)` — `payload` is `data[action.payloadField]` if specified or the entire panel data object.
- **WHY:** buttons in declarative panels must trigger declarative effects; arbitrary client handlers would defeat the JSON-serializable contract.

### `useUser` context

#### Scenario: `useUserProvider` populates the context once on mount
- **WHEN** the app mounts
- **THEN** `useUserProvider` calls `getAuthSession()` and exposes `user`, `workspaces`, `activeWorkspace`, `loading`, `isAdmin = activeWorkspace?.role === "admin"`.

#### Scenario: Network errors during refresh retry up to 3× with backoff
- **WHEN** `getAuthSession()` throws a `TypeError` (network error)
- **THEN** the loop retries with `1.5 s × attempt` delays; if all retries fail or any non-`TypeError` throws, the user is set to `null` and `loading` flips to false.
- **WHY:** dev server restarts must not flash "logged out" to the user; API errors must.

#### Scenario: `switchWorkspace` invalidates all queries before refresh
- **WHEN** the user switches workspaces
- **THEN** the hook calls `setActiveWorkspace(id)`, then `queryClient.invalidateQueries()` to force every data hook to refetch under the new workspace, then `refresh()` to update local state.

#### Scenario: `useWorkspaceId()` returns a stable empty string when no workspace
- **WHEN** any query key needs to scope by workspace
- **THEN** `useWorkspaceId()` returns `activeWorkspace?.id ?? ""`.
- **WHY:** an empty string is a valid React Query key segment (constant identity); `undefined` would cause keys like `["sessions", undefined]` which collide unpredictably.

#### Scenario: `session-expired` event triggers re-login
- **WHEN** any API call returns 401 (see `api-client` spec)
- **THEN** `window` dispatches a `"session-expired"` custom event; `useUserProvider` listens and calls `refresh()`, which re-checks `/api/auth/session` and sets `user: null` if the JWT is gone.
- **AND** `AppContent` unmounts the authenticated app and renders `<LoginPage />`.
- **WHY:** sessions can expire mid-use (e.g. after a server-side auth migration); mutations fail with 401 while stale GET cache makes the app look healthy. The event mechanism propagates the expiry to the auth gate without per-hook 401 handling.



## Technical Notes

| Concern | Location |
|---|---|
| Wire shapes (`UserProfile`, `Workspace`, `Session`, `Integration`, status unions, structured output types) | [src/types/index.ts](../../../src/types/index.ts) |
| Plugin interface, `FieldDef`, `BadgeConfig`, `FilterConfig`, `PluginContext`, `Entity` | `src/types/plugin.ts` |
| Widget schema (`WidgetDef`, `ProseWidget`, `KvTableWidget`, `DataTableWidget`, `ActionButtonsWidget`, ...) | [src/types/panels.ts](../../../src/types/panels.ts) |
| Per-message session payload union | [src/types/session-message.ts](../../../src/types/session-message.ts) |
| `useUserProvider`, `useUser`, `useWorkspaceId` with retry-on-network-error | [src/hooks/use-user.ts](../../../src/hooks/use-user.ts) |

## History

- Network-error retry on `refresh()` added after dev-server restarts caused the entire UI to flash to the login screen; users complained mid-typing.
- `TriggerSource` widened from a closed union to `... | (string & {})` after plugins started emitting their own trigger labels for analytics.
- `PluginItem` shape was originally `<TItem extends Record<string, unknown>>` generic; collapsed to plain `Record<string, unknown>` after the generic plumbing made every consuming component generic too without any type-safety win (schema-driven UI reads by name).
- `WidgetDef` extracted to `panels.ts` after `inbox-panels.json` consumers grew enough that having them in `index.ts` made the shared types file scroll for screens.
- `session-expired` window event added so 401 responses from expired JWTs (e.g. after auth migration) redirect to the sign-in page instead of showing error toasts on every mutation.
- `useWorkspaceId()` returns `""` instead of `undefined` after a query-key collision: two different unauthenticated states keyed `["sessions", undefined]` got merged in the React Query cache.
