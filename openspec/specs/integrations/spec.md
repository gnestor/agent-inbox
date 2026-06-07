# Integrations

## Purpose

Inbox's OAuth connection flow over the shared integration registry: build the authorize URL, exchange the code at the callback, and keep the connect-button UX correct across tabs. The registry itself (the `INTEGRATIONS` catalog, `IntegrationConfig`, lookup helpers, OAuth-field contract) moved to `@hammies/auth` ([`integrations`](../../../../auth/openspec/specs/integrations/spec.md)); inbox re-exports it via `server/lib/integrations.ts`.

## Context

### The registry lives in `@hammies/auth`
Why a single typed TS object (not JSON/DB), how OAuth metadata rides on each record so the connect route stays provider-agnostic, and the lookup helpers are documented in the auth [`integrations`](../../../../auth/openspec/specs/integrations/spec.md) spec. Inbox consumes that catalog and owns the *flow* below.

### Two scopes, two storage tables
`scope: "user"` integrations land in `user_credentials` after OAuth; `scope: "workspace"` integrations live in `workspace_credentials` and may be seeded from a workspace's `.env`. The vault enforces the resolution order (user beats workspace) — see `credentials-vault` spec.

### What is NOT in scope
- Encryption, vault tables, OAuth state map → `credentials-vault` spec.
- Settings UI rendering → `core-plugin` spec (it owns `IntegrationsPage`).
- Plugin loader and per-plugin config schemas → `plugin-system` spec.

> **The registry moved to `@hammies/auth`.** The `IntegrationConfig` shape, the `INTEGRATIONS` array, the lookup helpers (`getIntegration` / `getOAuthIntegrations` / `buildEnvToIntegrationMap`), and the OAuth-field contract (`tokenAuthMethod` / `tokenContentType`) are now owned by the [`integrations`](../../../../auth/openspec/specs/integrations/spec.md) spec in `@hammies/auth` (with their tests). Inbox re-exports the registry via `server/lib/integrations.ts`. This spec now covers only inbox's OAuth *flow* — building the authorize URL, exchanging the code, and the connect-button UX.

## Requirements

### OAuth flow contract

#### Scenario: Connection status reflects the server after an OAuth round-trip
- **WHEN** the `IntegrationCard` "Connect" button starts OAuth — the flow runs in a popup tab (`window.open`) and the callback redirects that tab to `/settings/integrations?connected=<id>`
- **THEN** the popup tab toasts success and broadcasts completion over the `oauth-connection` BroadcastChannel, which the original tab listens for to invalidate `["connections"]`.
- **AND** because that broadcast is best-effort, the `["connections"]` query is itself authoritative: `staleTime: 0`, `refetchOnMount: "always"`, `refetchOnWindowFocus: true`, and it is **excluded from IndexedDB persistence** (see the navigation spec's persistence predicate). A reload, or simply returning to the original tab after closing the popup, therefore refetches and shows the connected state — it never serves the pre-OAuth `connected: false` from the persisted 5-min-stale cache.

## Technical Notes

| Concern | Location |
|---|---|
| Registry (catalog + helpers + tests) | `@hammies/auth` `src/server/credentials/integrations.ts` (owned by auth `integrations`) |
| Registry re-export shim | `server/lib/integrations.ts` (owned by `credentials-vault`) |
| OAuth connect/callback routes that read this registry | `server/lib/credentials.ts` |
| Env-to-vault migration script (one-time seed) | [server/scripts/migrate-env-to-vault.ts](../../../server/scripts/migrate-env-to-vault.ts) |
| Settings page (lists integrations, handles OAuth callback toast) | [src/components/settings/IntegrationsPage.tsx](../../../src/components/settings/IntegrationsPage.tsx) |
| Per-integration card (connect/disconnect button) | [src/components/settings/IntegrationCard.tsx](../../../src/components/settings/IntegrationCard.tsx) |
| Integration icon component (per-provider SVG mapping) | [src/components/settings/IntegrationIcon.tsx](../../../src/components/settings/IntegrationIcon.tsx) |
| Frontend connections query + disconnect mutation hook | [src/hooks/use-connections.ts](../../../src/hooks/use-connections.ts) |

## History

- Registry started with Google + Notion only; per-provider OAuth code was inlined into the connect route. Refactored into a registry once Pinterest and QuickBooks added enough variation (basic vs body auth, JSON vs form bodies) that branching by `id` was unsustainable.
- `buildEnvToIntegrationMap()` was scoped to workspace-only after a migration attempt cross-attributed a user's Google refresh token to the workspace credential row.
- The connect button kept reading "Connect" after a successful OAuth: the `["connections"]` query was persisted to IndexedDB with the inbox-wide 5-min `staleTime` and `refetchOnWindowFocus: false`, so neither a reload nor refocusing the original tab refetched. Made the query authoritative (no persistence, `staleTime: 0`, refetch on mount + focus) so it self-corrects even when the cross-tab BroadcastChannel notification is missed.
