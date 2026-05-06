# Health, Rate Limit, Logging

## Purpose

Three orthogonal cross-cutting server primitives bundled in one spec because they share a single concern: making the server observably correct in dev and production. Health checks tell load balancers when to drain; the rate limiter protects unauthenticated endpoints from brute-force; the structured logger correlates requests across modules. None of these has enough surface area to deserve its own domain spec, but every other domain depends on them.

## Context

### Why a single in-memory rate limiter, not Redis
The inbox runs as a single Node process. A `Map<key, Bucket>` with a fixed-window counter is sufficient and has zero infrastructure dependencies. If horizontal scaling is ever introduced, the implementation must be replaced — `rate-limit.ts` is documented as single-instance for that reason.

### Why `AsyncLocalStorage` for request correlation
Pre-auth and post-auth log calls would otherwise have to thread a `requestId` through every call chain. `AsyncLocalStorage` makes the correlation invisible at every call site: callers just call `log.info(...)` and the request ID (and post-auth user email) get attached automatically.

### Why health is unauthenticated and DB-only
`/api/health` runs before the auth middleware so probes don't need credentials. It only reports component status — no schema, version, or stack traces leak.

### What is NOT in scope
- Auth middleware itself → `auth-and-sessions` spec.
- Per-route business logic — limiters and loggers are wired in the route's own spec, not here.

## Requirements

### Health checks

#### Scenario: `/api/health` returns 200 when DB and vault are ok
- **WHEN** `GET /api/health` is called
- **THEN** the response body is `{ status: "ok", timestamp, database, vault, plugins, workspaces }` with HTTP 200.

#### Scenario: Degraded health returns 503
- **WHEN** the database query fails OR `VAULT_SECRET` is unset/invalid
- **THEN** the route returns `{ status: "degraded", ... }` with HTTP 503 — `isHealthy()` returns false unless both DB and vault are ok.
- **AND** plugin and workspace status are reported but do NOT affect the 200/503 decision.

#### Scenario: VAULT_SECRET shape is validated, not just presence
- **WHEN** `VAULT_SECRET` is set but is not 64 hex characters
- **THEN** the vault check returns `{ status: "error", error: "VAULT_SECRET must be 64 hex characters" }`.
- **WHY:** a malformed secret causes silent decryption failures elsewhere — fail loud at startup.

#### Scenario: Database latency is reported
- **WHEN** the DB check succeeds
- **THEN** `latencyMs` is included so probes can alert on slow connections without a separate metric.

### Rate limiting

#### Scenario: Fixed-window counter per key
- **WHEN** a request hits a rate-limited route
- **THEN** the limiter increments a bucket keyed by `${label}:${keyFn(c)}`, default `keyFn` is `getClientIp(c)`.
- **AND** the response carries `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers.

#### Scenario: Over-limit requests are rejected with Retry-After
- **WHEN** the bucket count meets `max` within the window
- **THEN** the response is 429 `{ error: "Too many requests" }` with a `Retry-After` header in seconds.

#### Scenario: Buckets expire and are reaped
- **WHEN** the window elapses
- **THEN** the next hit resets the bucket to `count: 1`.
- **AND** an unref'd 60s reaper interval drops expired buckets so the Map doesn't grow unbounded.

#### Scenario: Client IP comes from forwarding headers when present
- **WHEN** the request has `x-forwarded-for`
- **THEN** the first comma-separated entry is used.
- **AND** `x-real-ip` is the fallback; `"unknown"` is the last resort.

### Structured logging

#### Scenario: Production emits JSON lines
- **WHEN** `NODE_ENV === "production"`
- **THEN** each log call writes one JSON object per line with `{ level, module, msg, ...ctx, ts }`.
- **AND** errors go to stderr; everything else to stdout.

#### Scenario: Development emits human-readable lines
- **WHEN** `NODE_ENV !== "production"`
- **THEN** the format is `[LEVEL] [module] req=<8-char-id> message key=value` with the request tag only when a context is active.

#### Scenario: `runWithRequestContext` injects requestId on every nested log
- **WHEN** a handler calls `runWithRequestContext({ requestId, userEmail? }, fn)`
- **THEN** every `log.*` call inside `fn` (including async descendants) auto-attaches `requestId` and, when present, `userEmail`.
- **AND** call-site context wins over auto-injected fields when keys collide.

#### Scenario: `LOG_LEVEL` filters output
- **WHEN** `LOG_LEVEL=warn` is set
- **THEN** debug and info calls are dropped; warn and error pass through.

#### Scenario: `child(ctx)` adds default fields
- **WHEN** a logger is created with `createLogger("foo").child({ sessionId })`
- **THEN** every subsequent call from the child logger includes `sessionId` without the caller passing it.

## Technical Notes

| Concern | Location |
|---|---|
| Health checks: DB ping, vault shape, plugin count, workspaces | [server/lib/health.ts](../../../server/lib/health.ts) |
| `/api/health` route, mounted before auth middleware | [server/index.ts:259-265](../../../server/index.ts#L259-L265) |
| In-memory rate limiter + middleware factory | [server/lib/rate-limit.ts](../../../server/lib/rate-limit.ts) |
| Structured logger + `AsyncLocalStorage` request context | [server/lib/logger.ts](../../../server/lib/logger.ts) |
| Health tests | [server/lib/__tests__/health.test.ts](../../../server/lib/__tests__/health.test.ts) |
| Rate-limit tests | [server/lib/__tests__/rate-limit.test.ts](../../../server/lib/__tests__/rate-limit.test.ts) |
| Logger tests | [server/lib/__tests__/logger.test.ts](../../../server/lib/__tests__/logger.test.ts) |

## History

- Health route placed before auth middleware so external probes don't need credentials.
- `VAULT_SECRET` shape check added after a deploy where the variable was set to a truncated value and credential decrypts silently failed.
- Logger switched to `AsyncLocalStorage` after an incident where logs from the same request couldn't be correlated across the auth boundary.
- Rate-limit reaper made `unref()`-safe so the interval doesn't keep tests alive.
