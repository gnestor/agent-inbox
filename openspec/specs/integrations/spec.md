# Integrations

## Purpose

A static registry describing every third-party integration the inbox knows how to authenticate with: id, display name, icon, scope (per-user vs per-[workspace](../workspace/spec.md)), auth type (`oauth2` or `api_key`), env vars it depends on, and OAuth endpoint metadata. The vault, OAuth callback, env-to-vault migration, and settings UI all read this single file. Adding an integration is a one-record edit; nothing else.

## Context

### Why a single TS object, not config files
The shape is small (≈25 records), the type is enforced by `IntegrationConfig`, and the only consumers are server-side code and the env-migration script. JSON would lose the type guarantee; a database table would require a migration for every addition. The trade-off is that a new integration needs a deploy — acceptable, because new integrations also need code (token refresh, plugin handlers).

### Two scopes, two storage tables
`scope: "user"` integrations land in `user_credentials` after OAuth; `scope: "workspace"` integrations live in `workspace_credentials` and may be seeded from a workspace's `.env`. The vault enforces the resolution order (user beats workspace) — see `credentials-vault` spec.

### Why OAuth metadata is on the integration, not the OAuth route
The `/api/connections/connect/:integration` flow is generic — it reads `authUrl`, `tokenUrl`, `scopes`, `clientIdEnv`/`clientSecretEnv`, `tokenAuthMethod` (basic vs body), and `tokenContentType` (form vs json) directly from the registry. This keeps the route free of provider-specific branches and means a Pinterest-vs-Google difference is one record's diff.

### What is NOT in scope
- Encryption, vault tables, OAuth state map → `credentials-vault` spec.
- Settings UI rendering → `core-plugin` spec (it owns `IntegrationsPage`).
- Plugin loader and per-plugin config schemas → `plugin-system` spec.

## Requirements

### Registry shape

#### Scenario: Each integration declares its credential env var
- **WHEN** any code reads `INTEGRATIONS`
- **THEN** every record has a non-empty `envVars.credential` string naming the primary token env var.
- **AND** any non-credential env vars (client ID, region, account ID) are listed in `envVars.config`.

#### Scenario: OAuth integrations carry endpoint metadata
- **WHEN** `authType === "oauth2"`
- **THEN** the record MUST include `authUrl`, `tokenUrl`, `scopes`, `clientIdEnv`, `clientSecretEnv`.
- **AND** optional fields are `authParams` (extra authorize-URL params), `tokenAuthMethod` (`"basic"` to send client creds via `Authorization: Basic`, default `"body"`), and `tokenContentType` (`"json"` or default `"form"`).
- **WHY:** providers disagree on token-exchange auth and content type — Pinterest needs basic auth, Notion needs JSON. The route reads these flags rather than branching per provider.

### Lookup helpers

#### Scenario: `getIntegration(id)` returns the record or undefined
- **WHEN** `getIntegration(id)` is called
- **THEN** it returns the matching record by `id` or `undefined` if no match.

#### Scenario: `getOAuthIntegrations()` filters to OAuth records
- **WHEN** the connections route enumerates connectable providers
- **THEN** `getOAuthIntegrations()` returns every `authType === "oauth2"` record.

#### Scenario: `buildEnvToIntegrationMap()` covers only workspace scope
- **WHEN** the env-to-vault migration script needs to map `.env` keys to integration ids
- **THEN** the helper returns `{ [envVar.credential]: integrationId }` for every `scope === "workspace"` integration only.
- **WHY:** user-scoped OAuth credentials must come from a real OAuth flow per user — auto-seeding them from `.env` would attribute one user's tokens to the workspace.

### OAuth flow contract

#### Scenario: The connect route reads only registry fields
- **WHEN** `/api/connections/connect/:integration` builds the authorize URL
- **THEN** it uses `authUrl`, `scopes` (joined by `" "`), `clientIdEnv` (resolved from `process.env`), and any `authParams` from the registry — no per-integration code branches.

#### Scenario: Token exchange honors `tokenAuthMethod` and `tokenContentType`
- **WHEN** the callback exchanges the code
- **THEN** if `tokenAuthMethod === "basic"`, the request sends `Authorization: Basic base64(clientId:clientSecret)` and omits client creds from the body.
- **AND** if `tokenContentType === "json"`, the body is `JSON.stringify(...)` with `Content-Type: application/json`; otherwise it is form-urlencoded.

#### Scenario: Connection status reflects the server after an OAuth round-trip
- **WHEN** the `IntegrationCard` "Connect" button starts OAuth — the flow runs in a popup tab (`window.open`) and the callback redirects that tab to `/settings/integrations?connected=<id>`
- **THEN** the popup tab toasts success and broadcasts completion over the `oauth-connection` BroadcastChannel, which the original tab listens for to invalidate `["connections"]`.
- **AND** because that broadcast is best-effort, the `["connections"]` query is itself authoritative: `staleTime: 0`, `refetchOnMount: "always"`, `refetchOnWindowFocus: true`, and it is **excluded from IndexedDB persistence** (see the navigation spec's persistence predicate). A reload, or simply returning to the original tab after closing the popup, therefore refetches and shows the connected state — it never serves the pre-OAuth `connected: false` from the persisted 5-min-stale cache.

## Technical Notes

| Concern | Location |
|---|---|
| `IntegrationConfig` type and `INTEGRATIONS` array | `server/lib/integrations.ts` |
| Lookup helpers (`getIntegration`, `getOAuthIntegrations`, `buildEnvToIntegrationMap`) | `server/lib/integrations.ts:276-297` |
| OAuth connect/callback routes that read this registry | `server/lib/credentials.ts` |
| Env-to-vault migration script (one-time seed) | [server/scripts/migrate-env-to-vault.ts](../../../server/scripts/migrate-env-to-vault.ts) |
| Registry tests | [server/lib/__tests__/integrations.test.ts](../../../server/lib/__tests__/integrations.test.ts) |
| Settings page (lists integrations, handles OAuth callback toast) | [src/components/settings/IntegrationsPage.tsx](../../../src/components/settings/IntegrationsPage.tsx) |
| Per-integration card (connect/disconnect button) | [src/components/settings/IntegrationCard.tsx](../../../src/components/settings/IntegrationCard.tsx) |
| Integration icon component (per-provider SVG mapping) | [src/components/settings/IntegrationIcon.tsx](../../../src/components/settings/IntegrationIcon.tsx) |
| Frontend connections query + disconnect mutation hook | [src/hooks/use-connections.ts](../../../src/hooks/use-connections.ts) |

## History

- Registry started with Google + Notion only; per-provider OAuth code was inlined into the connect route. Refactored into a registry once Pinterest and QuickBooks added enough variation (basic vs body auth, JSON vs form bodies) that branching by `id` was unsustainable.
- `buildEnvToIntegrationMap()` was scoped to workspace-only after a migration attempt cross-attributed a user's Google refresh token to the workspace credential row.
- The connect button kept reading "Connect" after a successful OAuth: the `["connections"]` query was persisted to IndexedDB with the inbox-wide 5-min `staleTime` and `refetchOnWindowFocus: false`, so neither a reload nor refocusing the original tab refetched. Made the query authoritative (no persistence, `staleTime: 0`, refetch on mount + focus) so it self-corrects even when the cross-tab BroadcastChannel notification is missed.
