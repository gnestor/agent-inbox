# Auth and Sessions

## Purpose

Authenticate users with Google Sign-In, mint a stateless JWT session cookie, and gate every `/api/*` route except the auth and health endpoints. This is the only auth boundary in the inbox — once a request passes the middleware, downstream code trusts `c.get("userEmail")` as authoritative.

## Context

### Why Google ID tokens, not OAuth flow
The browser does the full Google Sign-In dance (GIS button, popup, consent) and posts the resulting **ID token** to `/api/auth/callback`. The server verifies the token via `google-auth-library`'s `OAuth2Client.verifyIdToken` (in `@hammies/auth/server`) — no client secret, no redirect URI bookkeeping, no PKCE state to manage on the server. The library validates the JWT signature and freshness against Google's JWKS; we only check the `aud` claim against `GOOGLE_CLIENT_ID`.

### Why JWT cookies, shared across the monorepo
The session cookie is a JOSE-signed JWT (HS256, 14-day expiry) minted by `@hammies/auth/server`'s `signSession`. The cookie name `hammies_session` and the signing secret (`AUTH_SECRET`) are shared with the `vision` and `design` apps so a single sign-in cookie scoped to `.tail21f7c3.ts.net` provides SSO across all subdomains. Logout clears the cookie — there is no server-side session row to revoke, but the 14-day expiry caps blast radius.

The previous opaque-token scheme persisted sessions in `auth_sessions(token PRIMARY KEY)`. That table is no longer written or read; it remains in the database for rollback safety and may be dropped in a follow-up migration.

### Two layers of CSRF defense
- **SameSite=Lax** on the session cookie (set by `setCookie` in the callback route).
- **Origin/Referer check** in `csrfProtection` middleware on `/api/*` state-changing requests, with `/api/webhooks` and `/api/connections/connect` exempt because they receive third-party POSTs and OAuth redirects respectively.

If `Origin` and `Referer` are both missing (e.g. Vite dev proxy strips them, or non-browser clients), the request is allowed through with a debug log — the SameSite cookie remains as the primary defense.

### What is NOT in scope here
- Per-user encrypted credentials for third-party APIs → `credentials-vault` spec.
- Workspace membership / active-workspace cookie → `workspace` spec.
- Rate limiting → `rate-limit` spec (auth callback uses it; the limiter itself is its own concern).

## Requirements

### Sign-in flow

#### Scenario: Client fetches OAuth client ID
- **WHEN** the frontend calls `GET /api/auth/client-id`
- **THEN** the server returns `{ clientId }` from `process.env.GOOGLE_CLIENT_ID`.
- **AND** if the env var is unset, `getClientId()` throws and the request 500s — the frontend cannot render the sign-in button without it.

#### Scenario: Sign-in callback verifies the ID token
- **WHEN** the client POSTs `/api/auth/callback` with body `{ credential: <google-id-token> }`
- **THEN** the server delegates to `verifyGoogleIdToken` from `@hammies/auth/server`, which uses `google-auth-library`'s `OAuth2Client.verifyIdToken` against `GOOGLE_CLIENT_ID`.
- **AND** if verification fails (bad signature, wrong audience, expired, missing email), it throws and the request errors — no session is minted.

#### Scenario: Sign-in callback is rate-limited
- **WHEN** more than 10 callback requests arrive from the same client in a 60-second window
- **THEN** the limiter (label `"auth-callback"`) returns 429.
- **WHY:** brute-force or replay attempts on the unauthenticated endpoint should not consume Google's tokeninfo quota.

#### Scenario: Successful sign-in upserts user and mints JWT
- **WHEN** an ID token verifies
- **THEN** a row is upserted into `users` (email, name, picture, created_at, last_login_at) — `last_login_at` and `name`/`picture` are refreshed on every sign-in via `ON CONFLICT DO UPDATE`.
- **AND** a JWT is minted via `signSession({ sub: googleId, email, name, picture })` with a 14-day expiry.
- **AND** the cookie `hammies_session` is set via `sessionCookie(token, host)` from `@hammies/auth/server` — `httpOnly: true`, `sameSite: "Lax"`, `secure` in production, `path: "/"`, and `Domain=.tail21f7c3.ts.net` when the request host is on the Tailscale tailnet (enables SSO with vision and design).
- **AND** the response body contains `{ name, email, picture }`.

#### Scenario: Validation rejects malformed callback bodies
- **WHEN** the request body fails `AuthCallbackBody` Zod validation
- **THEN** the route returns 400 with the first issue's message — the credential is never sent to Google.

### Session lookup

#### Scenario: `GET /api/auth/session` with a valid cookie
- **WHEN** the `hammies_session` cookie is set and verifies via `verifySession`
- **THEN** the response includes `user`, the user's `workspaces` (id/name/role list), and `activeWorkspace` resolved from the workspace cookie or auto-claim fallback.

#### Scenario: `GET /api/auth/session` with no or invalid cookie
- **WHEN** the cookie is missing OR JWT verification throws (bad signature, expired)
- **THEN** the response is `{ user: null }` with status 200 — the frontend uses this to render the unauthenticated state.

#### Scenario: Logout clears the cookie
- **WHEN** `POST /api/auth/logout` is called
- **THEN** the `hammies_session` cookie is cleared via `sessionCookie(null, host)`.
- **AND** the response is `{ ok: true }` regardless of whether a cookie existed — logout is idempotent. JWT sessions are stateless so there is no server-side row to revoke; the 14-day expiry caps replay risk for stolen tokens.

### Auth middleware

#### Scenario: Auth middleware gates all `/api/*` routes
- **WHEN** any request hits `/api/*` after the unprotected `/api/auth` and `/api/health` routes
- **THEN** the middleware reads the `hammies_session` cookie, calls `getSession` (JWT verify), and 401s if missing or invalid.
- **AND** on success it sets `c.var.user`, `c.var.userEmail`, `c.var.userName`, `c.var.sessionToken` (the JWT itself), and (when resolvable) `c.var.workspace` for downstream handlers.

#### Scenario: Request correlation includes userEmail post-auth
- **WHEN** the auth middleware resolves a session
- **THEN** the request runs inside `runWithRequestContext({ requestId, userEmail })` so subsequent log calls auto-attach both fields.
- **WHY:** logs before auth resolution have `requestId` only; logs after include the user — required for incident triage.

### CSRF protection

#### Scenario: Safe methods bypass CSRF
- **WHEN** the request method is GET / HEAD / OPTIONS
- **THEN** `csrfProtection` calls `next()` without checking origin.

#### Scenario: State-changing request from an allowed origin passes
- **WHEN** the request is POST/PUT/PATCH/DELETE and the `Origin` header (or fallback `Referer` origin) is in `ALLOWED_ORIGINS`
- **THEN** the request proceeds.

#### Scenario: State-changing request from a foreign origin is blocked
- **WHEN** `Origin` is present and NOT in `ALLOWED_ORIGINS`
- **THEN** the response is 403 `{ error: "Forbidden origin" }` and a warn-level log records `method`, `path`, `origin`.

#### Scenario: Missing Origin/Referer is allowed with a debug log
- **WHEN** both headers are absent on a state-changing request
- **THEN** the request proceeds (SameSite cookie is the primary defense).
- **WHY:** Vite's dev proxy and non-browser clients legitimately omit these headers.

#### Scenario: Exempt paths skip CSRF entirely
- **WHEN** the request path starts with `/api/webhooks` or `/api/connections/connect`
- **THEN** the middleware calls `next()` regardless of origin.
- **WHY:** webhooks come from third-party servers (no browser origin); the OAuth connect callback is a redirect from the provider.

### Cookie configuration

| Cookie | Set by | Lifetime | SameSite | Secure | HttpOnly | Domain |
|---|---|---|---|---|---|---|
| `hammies_session` | `/api/auth/callback` | 14 days | Lax | only in production | yes | `.tail21f7c3.ts.net` on tailnet, host-only otherwise |
| `inbox_workspace` (`WORKSPACE_COOKIE`) | workspace routes (see workspace spec) | — | — | — | — | — |

The workspace cookie is read here only for routing — its lifecycle is owned by the workspace spec.

## Technical Notes

| Concern | Location |
|---|---|
| Inbox-side wrappers around `@hammies/auth/server` (`getClientId`, `verifyIdToken` upsert, `getSession`, no-op `deleteSession`) | [server/lib/auth.ts](../../../server/lib/auth.ts) |
| Auth routes (`/api/auth/client-id`, `/callback`, `/session`, `/logout`) | [server/routes/auth.ts](../../../server/routes/auth.ts) |
| `SESSION_COOKIE` re-exported from `@hammies/auth/server` (value `"hammies_session"`) | [server/routes/auth.ts](../../../server/routes/auth.ts) |
| Shared JWT signing/verification + cookie builder | `@hammies/auth/server` (packages/auth) |
| Auth middleware gating `/api/*` | `server/index.ts:268-291` |
| Origin/Referer CSRF middleware | [server/lib/csrf.ts](../../../server/lib/csrf.ts) |
| `AuthCallbackBody` Zod schema | [server/lib/schemas.ts](../../../server/lib/schemas.ts) |
| Rate limiter wrapper | `server/lib/rate-limit.ts` |
| `users` and `auth_sessions` tables | `server/db/migrations/001_initial_schema.sql` |
| Typed Hono context (`AppEnv` with `userEmail`, `googleAccessToken`) set by auth middleware | [server/types/hono-env.ts](../../../server/types/hono-env.ts) |

## History

- ID-token verification originally via Google's hosted `tokeninfo` endpoint; migrated to `google-auth-library`'s `OAuth2Client.verifyIdToken` (offline JWKS) when consolidating into `@hammies/auth/server`.
- Origin/Referer CSRF check added as a second layer behind SameSite cookies; webhook and OAuth-connect paths exempted to permit legitimate third-party POSTs.
- Auth middleware sets `userEmail` into the request context so logger calls downstream auto-attach the user.
- 2026-05: Migrated from opaque DB-backed sessions (`auth_sessions` table, cookie `inbox_session`) to JWT cookies (`hammies_session`) via `@hammies/auth/server`. Cookie scoped to `.tail21f7c3.ts.net` enables SSO with the design and vision apps. The `auth_sessions` table is no longer read or written, but is left in place for rollback safety. Existing sessions invalidated on cutover — users had to sign in again once.
