# Credentials Vault

## Purpose

Inbox's use of the shared credential vault: drive the two ingestion paths — interactive OAuth flows (`/api/connections/connect/...`) and one-time auto-seeding from a workspace's `.env` — wire on-demand token refresh, and supply the Agent-SDK `.env` credential map. The vault itself (encryption, per-user/per-[workspace](../workspace/spec.md) storage, resolution order) moved to `@hammies/auth` ([`credential-vault`](../../../../auth/openspec/specs/credential-vault/spec.md)); inbox re-exports it and injects its Postgres pool.

## Context

### The vault lives in `@hammies/auth`
The encryption, two-scope storage (`user_credentials` / `workspace_credentials`), user-beats-workspace resolution order, and AES-256-GCM details are owned by the [`credential-vault`](../../../../auth/openspec/specs/credential-vault/spec.md) spec in `@hammies/auth`. The tables themselves live in the studio DB. Inbox consumes the vault by re-exporting it (`server/lib/vault.ts`) and injecting its Postgres pool via `configureCredentialStore(...)` at startup. This section covers only inbox's *use* of the vault.

### Why a separate `credentials.ts` for `.env`-derived values
`server/lib/credentials.ts` is the legacy, in-process credential map loaded from a workspace's `.env` at boot. It is **NOT a vault** — values are plaintext in process memory and are used for two specific flows:
1. **Agent SDK environment** — `getAgentEnv()` returns env vars for spawned Claude sessions, with `ANTHROPIC_API_KEY` deliberately stripped so the user's Claude subscription is used instead of API credits.
2. **Auto-seeding** — `seedWorkspaceCredentials()` takes the parsed `.env` and inserts each value into `workspace_credentials` (encrypted) on first run, so a fresh deploy with only a `.env` boots into a working state.

Once seeded, the encrypted Postgres rows are authoritative. Editing `.env` does NOT update existing vault entries.

### OAuth state is in-memory and short-lived
The state param for OAuth CSRF is a 24-byte random hex string stored in a process-local `Map` with a 10-minute expiry, swept by a 60-second `setInterval`. This is fine because:
- A failed OAuth round-trip just retries.
- A server restart mid-flow is rare and the user can click "Connect" again.
- Persisting it would add a `oauth_states` table for no real benefit.

## Requirements

> **The vault implementation moved to `@hammies/auth`.** Encryption, per-user/per-workspace CRUD, resolution order, and `.env` seeding are now owned by the [`credential-vault`](../../../../auth/openspec/specs/credential-vault/spec.md) spec in `@hammies/auth` (with their tests). Inbox re-exports those functions via `server/lib/vault.ts` and configures the store with its pool at startup. The scenarios below cover what stays in inbox: the OAuth connections API, the `.env` Agent-SDK credential map, and wiring the shared refresh + lock primitive into the credential proxy.

### Connections API

#### Scenario: `GET /connections` reports connected status without leaking tokens
- **WHEN** the user is authenticated
- **THEN** the response is a list of integrations with `id`, `name`, `icon`, `scope`, `authType`, and a boolean `connected`.
- **AND** for `scope === "user"`, `connected` is true iff a `user_credentials` row exists.
- **AND** for `scope === "workspace"`, `connected` is true iff a `workspace_credentials` row exists OR the matching `.env` var (`config.envVars.credential`) is present in process memory (transitional fallback during the .env→vault migration).

#### Scenario: `GET /connections/connect/:integration` starts an OAuth flow
- **WHEN** the integration's `authType === "oauth2"` and both `authUrl` and `clientIdEnv` are configured
- **THEN** a 24-byte hex state is generated and stored in `oauthStates` with a 10-minute expiry, keyed by state and bound to `(userEmail, integration, origin)`.
- **AND** the user is redirected to `${authUrl}?client_id=...&redirect_uri=${origin}/api/connections/connect/${integration}/callback&response_type=code&state=...&scope=...&<authParams>`.
- **AND** the request is rate-limited (label `"oauth-connect"`, 20/min keyed by userEmail or client IP).

#### Scenario: Origin is captured at connect-time and reused at callback-time
- **WHEN** the connect endpoint resolves the request origin (preferring `?origin=` query, then `Origin` header, then `Referer`-derived, then `req.url` origin)
- **THEN** the resolved origin is stored alongside the state.
- **AND** the callback constructs `redirect_uri` from the **stored** origin, not the callback request's headers.
- **WHY:** Vite's dev proxy strips the `Origin` header; the callback redirect can come back through a different host than the connect request started from. The stored origin is the only value that matches what the provider received during authorize.

#### Scenario: OAuth callback validates state, exchanges code, stores token
- **WHEN** `GET /connections/connect/:integration/callback` is hit with valid `code` and `state`
- **THEN** the state row is looked up and deleted (single use), expiry is checked, and `oauthState.integration === :integration` is enforced.
- **AND** the authorization code is exchanged at `config.tokenUrl` using either form-encoded body (default) or HTTP Basic with form/JSON body (`tokenAuthMethod === "basic"`).
- **AND** the access token is extracted from `tokenData.access_token` OR `tokenData.authed_user.access_token` (Slack v2) OR `tokenData.bot.bot_access_token`.
- **AND** the token is stored via `storeUserCredential` with `refreshToken`, `scopes` (from response or config fallback), and `expiresAt` derived from `expires_in`.
- **AND** the user is redirected to `/settings/integrations?connected=<integration>` on success or `?error=...` on failure.

#### Scenario: OAuth callback rejects mismatched or expired state
- **WHEN** the state is missing, expired, or its stored `integration` does not match the URL param
- **THEN** the request returns 400 and no token exchange occurs.

#### Scenario: `DELETE /connections/:integration` removes user credential only
- **WHEN** the integration is `scope === "user"` and the user is authenticated
- **THEN** the matching `user_credentials` row is deleted.
- **WHEN** the integration is `scope === "workspace"`
- **THEN** the response is 403 — workspace credentials are not user-deletable through this endpoint.

### Agent SDK environment

#### Scenario: `getAgentEnv()` strips `ANTHROPIC_API_KEY`
- **WHEN** an agent session is spawned and the server passes env vars to the SDK
- **THEN** every `.env` value is included EXCEPT `ANTHROPIC_API_KEY`.
- **WHY:** Claude Code uses the user's subscription-based auth when no API key is present; presence of the key would silently switch to API-credits billing.

### Access token refresh

> Refresh + the advisory-lock serialization moved to `@hammies/auth` ([`credential-vault`](../../../../auth/openspec/specs/credential-vault/spec.md), with tests). Inbox's role is to (a) wire `maybeRefreshToken` into the credential proxy's `resolveCredential` callback, and (b) **implement the lock primitive**: the `withAdvisoryLock` on inbox's credential-store adapter acquires a dedicated pool connection, takes a `pg_advisory_lock`, and runs the whole critical section on that one connection so refresh is deadlock-free.

## Technical Notes

| Concern | Location |
|---|---|
| Vault re-export shim (impl + tests in `@hammies/auth` `credential-vault`) | [server/lib/vault.ts](../../../server/lib/vault.ts) |
| Vault implementation | `@hammies/auth` `src/server/credentials/*` (owned by `credential-vault`) |
| Refresh + expiry + advisory-lock serialization | `@hammies/auth` `src/server/credentials/{refresh,expiry}.ts` (owned by `credential-vault`) |
| Store configured + `withAdvisoryLock` impl (dedicated connection) at startup | `server/index.ts` `configureCredentialStore(...)` (file owned by `health-rate-limit-logging`) |
| In-process .env credential map (legacy + Agent SDK env) | [server/lib/credentials.ts](../../../server/lib/credentials.ts) |
| `getAgentEnv()` strips ANTHROPIC_API_KEY | [server/lib/credentials.ts:39-47](../../../server/lib/credentials.ts#L39-L47) |
| `/connections` REST routes | [server/routes/connections.ts](../../../server/routes/connections.ts) |
| In-memory OAuth state map | [server/routes/connections.ts:24-35](../../../server/routes/connections.ts#L24-L35) |
| Integration registry (auth type, scopes, token URLs) | [server/lib/integrations.ts](../../../server/lib/integrations.ts) |
| Credential tables now live in studio's DB | `packages/studio/src/server/credentials/schema.sql` (owned by `studio`) |

## History

- AES-256-GCM with per-encryption IV chosen so identical plaintexts produce different ciphertexts and tampering fails authentication.
- User-scope-beats-workspace-scope resolution order locked in to prevent a workspace token shadowing a user's personal OAuth grant.
- Origin captured at OAuth connect-time and threaded through to the callback because Vite's dev proxy strips `Origin` headers, breaking redirect-URI matching otherwise.
- `getAgentEnv()` excludes `ANTHROPIC_API_KEY` so Claude sessions use the user's subscription instead of being silently billed to API credits.
- `seedWorkspaceCredentials()` only inserts missing integrations — once a row exists in the vault, editing `.env` no longer affects it.
- 2026-06-07: Token refresh serialized with a transaction-scoped Postgres advisory lock + double-check, after concurrent/independent refreshers forked the QuickBooks token chain and silently killed the data-pipeline tap. Expiry decision extracted to `credential-expiry.ts` for unit testing. First step of the unified credential-vault initiative (`packages/auth/openspec/changes/quickbooks-credential-vault/`).
- 2026-06-07: Vault implementation (encrypt/decrypt, CRUD, resolve, seed) + its tests moved to `@hammies/auth` (`credential-vault` spec); `server/lib/vault.ts` is now a re-export shim and inbox injects its pool via `configureCredentialStore` at startup. Tables migrated to studio's DB. Step 2a of the unified credential-vault initiative.
- 2026-06-07: Refresh + expiry moved to `@hammies/auth` too; the inline transaction-scoped lock was replaced by a `withAdvisoryLock` store primitive that inbox implements on a dedicated connection (deadlock-free, resolving the step-1 nested-connection caveat). `credential-expiry.ts` deleted (now in auth). Step 2c.
