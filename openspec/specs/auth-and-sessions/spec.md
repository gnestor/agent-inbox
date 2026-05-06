# Auth and Sessions

## Purpose

Authenticate users with Google Sign-In, persist a server-side session in Postgres, and gate every `/api/*` route except the auth and health endpoints. This is the only auth boundary in the inbox — once a request passes the middleware, downstream code trusts `c.get("userEmail")` as authoritative.

## Context

### Why Google ID tokens, not OAuth flow
The browser does the full Google Sign-In dance (GIS button, popup, consent) and posts the resulting **ID token** to `/api/auth/callback`. The server verifies the token by calling `oauth2.googleapis.com/tokeninfo` — no client secret, no redirect URI bookkeeping, no PKCE state to manage on the server. Google's hosted endpoint validates the JWT signature and freshness for us; we only check the `aud` claim against `GOOGLE_CLIENT_ID`.

### Why opaque cookie tokens, not signed JWTs
The session token is 32 random bytes, hex-encoded, stored in `auth_sessions(token PRIMARY KEY)`. This means logout is instant (DELETE) and there is no signing key to rotate. The trade-off is one Postgres `SELECT` per authenticated request — acceptable because every request already touches the DB for workspace resolution.

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
- **THEN** the server calls Google's `tokeninfo` endpoint with the credential.
- **AND** verifies `payload.aud === GOOGLE_CLIENT_ID`.
- **AND** if either step fails, returns an error and does NOT create a session.

#### Scenario: Sign-in callback is rate-limited
- **WHEN** more than 10 callback requests arrive from the same client in a 60-second window
- **THEN** the limiter (label `"auth-callback"`) returns 429.
- **WHY:** brute-force or replay attempts on the unauthenticated endpoint should not consume Google's tokeninfo quota.

#### Scenario: Successful sign-in upserts user and creates session
- **WHEN** an ID token verifies
- **THEN** a row is upserted into `users` (email, name, picture, created_at, last_login_at) — `last_login_at` and `name`/`picture` are refreshed on every sign-in via `ON CONFLICT DO UPDATE`.
- **AND** a fresh 32-byte hex `sessionToken` is inserted into `auth_sessions`.
- **AND** the cookie `inbox_session` is set with `httpOnly: true`, `sameSite: "Lax"`, `secure` only when `NODE_ENV === "production"`, `path: "/"`, `maxAge: 7 days`.
- **AND** the response body contains `{ name, email, picture }`.

#### Scenario: Validation rejects malformed callback bodies
- **WHEN** the request body fails `AuthCallbackBody` Zod validation
- **THEN** the route returns 400 with the first issue's message — the credential is never sent to Google.

### Session lookup

#### Scenario: `GET /api/auth/session` with a valid cookie
- **WHEN** the cookie is set and matches a row in `auth_sessions`
- **THEN** the response includes `user`, the user's `workspaces` (id/name/role list), and `activeWorkspace` resolved from the workspace cookie or auto-claim fallback.

#### Scenario: `GET /api/auth/session` with no or invalid cookie
- **WHEN** the cookie is missing OR there is no matching row
- **THEN** the response is `{ user: null }` with status 200 — the frontend uses this to render the unauthenticated state.

#### Scenario: Logout revokes the session row and clears the cookie
- **WHEN** `POST /api/auth/logout` is called
- **THEN** the row in `auth_sessions` is deleted (if present) and the `inbox_session` cookie is cleared.
- **AND** the response is `{ ok: true }` regardless of whether the cookie or row existed — logout is idempotent.

### Auth middleware

#### Scenario: Auth middleware gates all `/api/*` routes
- **WHEN** any request hits `/api/*` after the unprotected `/api/auth` and `/api/health` routes
- **THEN** the middleware reads the `inbox_session` cookie, looks up the session, and 401s if missing or unknown.
- **AND** on success it sets `c.var.user`, `c.var.userEmail`, `c.var.userName`, `c.var.sessionToken`, and (when resolvable) `c.var.workspace` for downstream handlers.

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

| Cookie | Set by | Lifetime | SameSite | Secure | HttpOnly |
|---|---|---|---|---|---|
| `inbox_session` | `/api/auth/callback` | 7 days | Lax | only in production | yes |
| `inbox_workspace` (`WORKSPACE_COOKIE`) | workspace routes (see workspace spec) | — | — | — | — |

The workspace cookie is read here only for routing — its lifecycle is owned by the workspace spec.

## Technical Notes

| Concern | Location |
|---|---|
| ID-token verification, session create/get/delete | [server/lib/auth.ts](../../../server/lib/auth.ts) |
| Auth routes (`/api/auth/client-id`, `/callback`, `/session`, `/logout`) | [server/routes/auth.ts](../../../server/routes/auth.ts) |
| `SESSION_COOKIE = "inbox_session"` | [server/routes/auth.ts:15](../../../server/routes/auth.ts#L15) |
| Auth middleware gating `/api/*` | [server/index.ts:268-291](../../../server/index.ts#L268-L291) |
| Origin/Referer CSRF middleware | [server/lib/csrf.ts](../../../server/lib/csrf.ts) |
| `AuthCallbackBody` Zod schema | [server/lib/schemas.ts](../../../server/lib/schemas.ts) |
| Rate limiter wrapper | [server/lib/rate-limit.ts](../../../server/lib/rate-limit.ts) |
| `users` and `auth_sessions` tables | [server/db/migrations/001_initial_schema.sql](../../../server/db/migrations/001_initial_schema.sql) |
| Typed Hono context (`AppEnv` with `userEmail`, `googleAccessToken`) set by auth middleware | [server/types/hono-env.ts](../../../server/types/hono-env.ts) |

## History

- ID-token verification via Google's hosted `tokeninfo` endpoint (no client-secret-based OAuth flow on the server).
- Origin/Referer CSRF check added as a second layer behind SameSite cookies; webhook and OAuth-connect paths exempted to permit legitimate third-party POSTs.
- Auth middleware sets `userEmail` into the request context so logger calls downstream auto-attach the user.
