# Credentials Vault

## Purpose

Encrypt and persist third-party API credentials (OAuth tokens, refresh tokens, API keys) in Postgres, scoped per-user and per-[workspace](../workspace/spec.md), with a single resolution order that downstream code can rely on. The vault is also the destination for two ingestion paths: interactive OAuth flows (`/api/connections/connect/...`) and one-time auto-seeding from a workspace's `.env` file.

## Context

### Two scopes, one resolution order
Credentials live in two tables:
- `user_credentials(user_email, integration)` — per-user, used for personal [integrations](../integrations/spec.md) (Gmail, Slack user token).
- `workspace_credentials(workspace, integration)` — per-workspace, used when every member of a workspace shares the same credential (e.g. a Notion bot token).

Resolution order is fixed: **user-scoped beats workspace-scoped.** A user with their own Gmail token uses it; a user without falls back to the workspace's. Reverse priority would be a security regression — a workspace token shadowing a user's personal grant.

### Why AES-256-GCM with a single key
We need authenticated encryption (so a tampered ciphertext fails decryption rather than producing garbage), and we need it for short strings stored in a relational DB. AES-256-GCM with `VAULT_SECRET` (64 hex chars = 32 bytes) is the minimum that satisfies both. Format on disk: `iv_hex:authTag_hex:ciphertext_hex` — the IV is generated per-encryption with `randomBytes(16)`, so the same plaintext encrypts to different ciphertexts each time.

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

### Encryption

#### Scenario: `VAULT_SECRET` validation at first use
- **WHEN** any encrypt/decrypt operation runs and `VAULT_SECRET` is unset, shorter than 64 chars, or contains non-hex characters
- **THEN** an error is thrown naming the variable and giving the exact `node -e "..."` command to generate one.
- **WHY:** failing fast at first use beats producing ciphertexts that cannot be decrypted later.

#### Scenario: `encrypt()` produces fresh IV per call
- **WHEN** the same plaintext is passed to `encrypt()` twice
- **THEN** the two outputs have different `iv_hex` prefixes and therefore different ciphertexts.
- **AND** both decrypt back to the original plaintext.

#### Scenario: `decrypt()` rejects tampered ciphertext
- **WHEN** any of `iv`, `authTag`, or `ciphertext` is altered
- **THEN** `decipher.final()` throws a GCM auth-tag mismatch error and no plaintext is returned.

### Per-user credentials

#### Scenario: `storeUserCredential` upserts encrypted token + optional refresh token
- **WHEN** called with `{ token, refreshToken?, scopes?, expiresAt? }`
- **THEN** `token` and (if provided) `refreshToken` are encrypted before insertion.
- **AND** `scopes` and `expiresAt` are stored as-is (not encrypted).
- **AND** an existing `(user_email, integration)` row is overwritten via `ON CONFLICT DO UPDATE`.

#### Scenario: `getUserCredential` returns plaintext token or null
- **WHEN** the row exists
- **THEN** both `token` and (if present) `refreshToken` are decrypted before return.
- **WHEN** the row does not exist
- **THEN** the function returns `null` (not undefined, not throw).

#### Scenario: `listUserCredentials` returns metadata only
- **WHEN** called for a user
- **THEN** the response includes `integration`, `scopes`, `expiresAt`, `updatedAt` for each row.
- **AND** does NOT include the encrypted token or refresh token.
- **WHY:** this is the data shape the connections UI shows; tokens never leave the server in list responses.

#### Scenario: `deleteUserCredential` is idempotent
- **WHEN** called for an integration the user has never connected
- **THEN** the DELETE affects zero rows and the function returns normally.

### Per-workspace credentials

#### Scenario: `storeWorkspaceCredential` upserts a single encrypted token
- **WHEN** called with `(workspace, integration, token)`
- **THEN** the token is encrypted and upserted into `workspace_credentials`.
- **AND** there is no `refreshToken`/`scopes`/`expiresAt` — workspace credentials are simple bearer tokens.

#### Scenario: `getWorkspaceCredential` returns the decrypted token or null
- **WHEN** the `(workspace, integration)` row exists, the encrypted token is decrypted and returned.
- **WHEN** the row does not exist, `null` is returned.

### Resolution order

#### Scenario: User credential takes precedence
- **WHEN** `resolveCredential(userEmail, workspace, integration)` is called and a `user_credentials` row exists for that user
- **THEN** the user's token is returned regardless of any workspace credential.

#### Scenario: Falls back to workspace credential
- **WHEN** the user has no row for the integration
- **THEN** `resolveCredential` returns the workspace credential, or `null` if neither exists.

### Auto-seeding from `.env`

#### Scenario: First-run seed inserts only missing integrations
- **WHEN** `seedWorkspaceCredentials(workspaceName, envVars, envToIntegration)` runs
- **THEN** for each `(envKey, integration)` pair where `envVars[envKey]` is non-empty AND no `workspace_credentials` row exists yet, the value is encrypted and inserted.
- **AND** existing rows are NEVER overwritten — the vault is authoritative once seeded.

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

#### Scenario: A credential past its expiry is refreshed
- **WHEN** a stored credential's `expiresAt` is at or before `now` (or within the 60s skew)
- **THEN** `isCredentialExpired` reports true and the access token is refreshed before use.

#### Scenario: A credential within the skew window is refreshed
- **WHEN** `expiresAt` is in the future but within the skew margin
- **THEN** it is treated as expired and refreshed early, so a token never lapses mid-request.

#### Scenario: A comfortably valid credential is not refreshed
- **WHEN** `expiresAt` is beyond the skew margin
- **THEN** the cached access token is returned without a refresh call.

#### Scenario: A credential with no expiry is not treated as expired
- **WHEN** `expiresAt` is null/absent (e.g. a workspace bearer token)
- **THEN** it is never refreshed on expiry grounds.

**Refresh serialization (DB-concurrency invariant — not unit-asserted, so not a Scenario).** When two callers both find the token expired and attempt to refresh concurrently, a transaction-scoped Postgres advisory lock (`pg_advisory_xact_lock` on a hash of `user:integration`) forces them to run one at a time; the second re-reads under the lock and reuses the first's freshly-persisted token instead of issuing its own refresh. **WHY:** OAuth providers (notably QuickBooks) rotate the refresh token on every use and revoke the whole token family if a stale token is presented after a newer one — concurrent refreshers fork and kill the chain. This silently broke the data-pipeline tap (May 2026); see `packages/auth/openspec/changes/quickbooks-credential-vault/proposal.md`. The expiry-decision scenarios above cover the refresh *trigger*; the lock itself is verified by behavior, not a unit test.

## Technical Notes

| Concern | Location |
|---|---|
| AES-256-GCM encrypt/decrypt + key validation | [server/lib/vault.ts:24-47](../../../server/lib/vault.ts#L24-L47) |
| Access-token expiry decision (pure, testable) | [server/lib/credential-expiry.ts](../../../server/lib/credential-expiry.ts) |
| Lazy refresh + advisory-lock serialization | `server/index.ts` `maybeRefreshToken` / `refreshOAuthAccessToken` (file owned by `health-rate-limit-logging`) |
| User credential CRUD | [server/lib/vault.ts:57-128](../../../server/lib/vault.ts#L57-L128) |
| Workspace credential CRUD | [server/lib/vault.ts:130-157](../../../server/lib/vault.ts#L130-L157) |
| `resolveCredential` (user > workspace) | [server/lib/vault.ts:163-172](../../../server/lib/vault.ts#L163-L172) |
| `seedWorkspaceCredentials` (.env → vault) | [server/lib/vault.ts:178-198](../../../server/lib/vault.ts#L178-L198) |
| In-process .env credential map (legacy + Agent SDK env) | [server/lib/credentials.ts](../../../server/lib/credentials.ts) |
| `getAgentEnv()` strips ANTHROPIC_API_KEY | [server/lib/credentials.ts:39-47](../../../server/lib/credentials.ts#L39-L47) |
| `/connections` REST routes | [server/routes/connections.ts](../../../server/routes/connections.ts) |
| In-memory OAuth state map | [server/routes/connections.ts:24-35](../../../server/routes/connections.ts#L24-L35) |
| Integration registry (auth type, scopes, token URLs) | [server/lib/integrations.ts](../../../server/lib/integrations.ts) |
| Tables `user_credentials`, `workspace_credentials` | `server/db/migrations/001_initial_schema.sql:75-94` |

## History

- AES-256-GCM with per-encryption IV chosen so identical plaintexts produce different ciphertexts and tampering fails authentication.
- User-scope-beats-workspace-scope resolution order locked in to prevent a workspace token shadowing a user's personal OAuth grant.
- Origin captured at OAuth connect-time and threaded through to the callback because Vite's dev proxy strips `Origin` headers, breaking redirect-URI matching otherwise.
- `getAgentEnv()` excludes `ANTHROPIC_API_KEY` so Claude sessions use the user's subscription instead of being silently billed to API credits.
- `seedWorkspaceCredentials()` only inserts missing integrations — once a row exists in the vault, editing `.env` no longer affects it.
- 2026-06-07: Token refresh serialized with a transaction-scoped Postgres advisory lock + double-check, after concurrent/independent refreshers forked the QuickBooks token chain and silently killed the data-pipeline tap. Expiry decision extracted to `credential-expiry.ts` for unit testing. First step of the unified credential-vault initiative (`packages/auth/openspec/changes/quickbooks-credential-vault/`).
