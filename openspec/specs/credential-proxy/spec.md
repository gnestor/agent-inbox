# Credential Proxy

## Purpose

A localhost MITM HTTPS proxy that lets agent subprocesses make authenticated calls to third-party APIs (Notion, GitHub, Slack, Google, Shopify, Klaviyo, Meta, etc.) without ever seeing user credentials. The proxy authenticates the agent by a session token carried in `Proxy-Authorization`, looks up the matching credential from the vault, and rewrites the request — Bearer header, custom header, Basic auth, or query param — based on a per-[integration](../integrations/spec.md) policy. Agent subprocesses opt in by inheriting `HTTPS_PROXY`, `NO_PROXY` (bypass list for hosts the proxy doesn't intercept), `NODE_EXTRA_CA_CERTS`, and a `NODE_OPTIONS --import` preload that wires `undici`'s global dispatcher.

## Context

### Why a MITM proxy and not a per-skill SDK
Skills emitted by the agent are arbitrary code. If each skill had to load a credential out of an env var, plumb it through whatever HTTP client it imported, and avoid logging it, every new skill would be a fresh credential-leakage risk. A proxy keeps secrets out of the agent's address space entirely — the skill writes `fetch("https://api.notion.com/...")` with no token, and the proxy injects one.

### Why CONNECT + TLS termination per host
HTTPS clients send `CONNECT api.notion.com:443` to the proxy, expecting a tunnel. To rewrite headers we have to terminate TLS — which means we need a cert for `api.notion.com` that the agent trusts. We generate a self-signed CA at startup, sign a per-host cert on demand, and feed the CA bundle into the agent via `NODE_EXTRA_CA_CERTS`. Hosts not on the intercept allowlist get a transparent socket-pipe tunnel — no decryption, no rewrite.

### Why per-integration auth methods
Real APIs use four flavours of credential injection: standard Bearer (`Authorization: Bearer ...`), custom header (Shopify's `X-Shopify-Access-Token`, Klaviyo's `Klaviyo-API-Key`), Basic auth where one side comes from `extras` (Gorgias uses `email:token`), and query param (Meta `access_token=...`, Gemini `key=...`). A single `INTEGRATION_AUTH` map drives all four — adding a new integration is one line, not a new code path.

### Why the session token rides in `Proxy-Authorization`, not a custom header
HTTP clients (curl, undici, Python `requests`) automatically encode the userinfo of the proxy URL into a Basic `Proxy-Authorization` header when given `HTTPS_PROXY=http://<token>@127.0.0.1:<port>`. Reusing the standard mechanism means skills don't need a custom client config — they inherit `HTTPS_PROXY` via env and the rest is automatic. We accept Bearer too for clients that support it, but Basic-with-empty-password is the universal path.

### Why `agent-proxy-preload.mjs` exists
Node's `fetch()` is built on `undici`, which does *not* read `HTTPS_PROXY` automatically — only `node-fetch` and the legacy `http` module do. The preload script (`NODE_OPTIONS=--import`) sets `setGlobalDispatcher(new ProxyAgent(...))` so `fetch()` flows through the proxy. The token is forwarded via the `ProxyAgent`'s `token` option because `undici` doesn't parse userinfo from the URI string.

### Why per-host certs are LRU-capped at 100
Each `generateCertForHost` call runs RSA keygen (2048 bits) — ~50 ms cold. Caching avoids doing this on every CONNECT for the same host, but unbounded growth would let a long-lived agent generate thousands of certs (every `*.googleapis.com` subdomain, every Shopify store) and balloon memory. 100 entries with LRU eviction (touched cert moves to MRU) keeps the cache hot for actively-used hosts.

### Why we send the `200 Connection Established` *before* emitting the TLS connection
A subtle ordering bug: if the TLS server starts the handshake before the client sees the `200`, the client treats the bytes as belonging to the (not-yet-confirmed) HTTP response, mangles the handshake, and the connection dies. Writing `200 ...` first, then `tlsServer.emit("connection", clientSocket)`, then `unshift` any leftover bytes from the original CONNECT, is the correct sequence.

### Why query-param injection rewrites the request line, not the headers
For Meta/Gemini-style query auth, the credential goes in the URL itself. We parse the request line, set/replace the auth param via `URLSearchParams`, and rebuild the line. Headers are left alone (no `Authorization: ...` added). Skills that already include a placeholder param have it overwritten; skills that don't have it added.

### Why the proxy listens on 127.0.0.1 only
The proxy holds every user's credentials in resolvable form. Binding to `0.0.0.0` would expose a credential lookup endpoint to the local network, gated only by guessable session tokens. `127.0.0.1` plus the agent subprocess being a child of the inbox server (sharing the loopback) is the trust boundary.

### What is NOT in scope
- The credential vault itself (encryption, refresh) → `credentials-vault` spec.
- Session-token issuance and validation → `auth-and-sessions` spec.
- How the agent subprocess inherits the proxy env vars at spawn time → `session-manager` spec (`getProxyEnv` consumer).
- Per-integration OAuth refresh logic invoked by `resolveCredential` → `integrations` spec.

## Requirements

### Intercept allowlist and integration mapping

#### Scenario: Only allowlisted hosts are MITM-intercepted
- **WHEN** the agent issues a CONNECT for an arbitrary host
- **THEN** `shouldIntercept(host)` returns true iff `host === h` or `host.endsWith(\`.${h}\`)` for some `h` in `INTERCEPTED_HOSTS`.
- **AND** non-matching hosts get a transparent TCP pipe — the proxy never touches the bytes.

#### Scenario: `hostToIntegration` maps hostnames to vault integration names
- **WHEN** an intercepted CONNECT arrives
- **THEN** `hostToIntegration(host)` returns the vault key — e.g. `api.notion.com → "notion"`, `*.shopify.com → "shopify"`, `generativelanguage.googleapis.com → "gemini"`, all other `*.googleapis.com → "google"`.
- **AND** the order of checks matters: specific subdomains (`generativelanguage.googleapis.com`) are tested before catch-all patterns (`googleapis.com`).

### Auth-method dispatch (`INTEGRATION_AUTH`)

#### Scenario: Bearer integrations get `Authorization: Bearer <token>`
- **WHEN** the integration is `notion`, `github`, `slack`, `google`, `air`, `quickbooks`, or `pinterest`
- **THEN** the proxy adds (or replaces) `Authorization: Bearer ${cred.token}` on the outgoing request.

#### Scenario: Header-named integrations get a custom header
- **WHEN** the integration is `shopify` or `klaviyo`
- **THEN** the proxy adds/replaces `X-Shopify-Access-Token: <token>` or `Klaviyo-API-Key: <token>` respectively — matching is case-insensitive on the existing header name.

#### Scenario: Basic-auth integrations encode `<extra>:<token>`
- **WHEN** the integration is `gorgias`
- **THEN** the proxy emits `Authorization: Basic ${base64("${cred.extras.email}:${cred.token}")}`.
- **AND** missing `extras.email` resolves to an empty string (encoded as `:token`) rather than throwing — the upstream auth failure is the correct error surface.

#### Scenario: Query-param integrations rewrite the request URL
- **WHEN** the integration is `meta`, `instagram`, or `gemini`
- **THEN** the proxy parses the request line, sets `URLSearchParams[param] = cred.token` (`access_token` for Meta/Instagram, `key` for Gemini), and emits a new request line with the updated `pathname + search`.
- **AND** no auth header is added or modified.

#### Scenario: Existing auth header is replaced, not duplicated
- **WHEN** the agent's request already contains an `Authorization:` (or the integration-specific) header
- **THEN** the existing line is dropped from the rebuilt header list and the proxy's injected line takes its place — no two `Authorization` lines are sent.

#### Scenario: Missing credential leaves the request unchanged
- **WHEN** `resolveCredential(sessionToken, integration)` returns null
- **THEN** no header or URL rewrite happens — the agent's request is forwarded as-is and the upstream API returns its own 401, which the agent sees verbatim.

### CONNECT handling

#### Scenario: Session token is extracted from `Proxy-Authorization`
- **WHEN** the CONNECT carries `Proxy-Authorization: Basic <base64>`
- **THEN** the proxy decodes the base64, strips a trailing `:`, and uses the result as the session token.
- **AND** when the header is `Bearer <token>`, the prefix is stripped and the rest is the token.
- **AND** when the header is missing, `sessionToken` is empty and `resolveCredential` is not called — the request flows through with no rewrite.

#### Scenario: Per-host cert is generated on demand and LRU-cached
- **WHEN** a CONNECT arrives for an intercepted host
- **THEN** `generateCertForHost(host, ca)` returns a cached cert if present (touched to MRU) or generates a new self-signed cert with `subjectAltName: [DNS:${host}]` signed by the proxy CA.
- **AND** the cache holds at most `MAX_HOST_CERTS = 100` entries; when full, the LRU entry is evicted.

#### Scenario: TLS handshake order — `200` first, then `connection` event, then `unshift`
- **WHEN** the proxy is ready to serve a MITM tunnel
- **THEN** it writes `HTTP/1.1 200 Connection Established\r\n\r\n` to the client socket, *then* calls `tlsServer.emit("connection", clientSocket)`, *then* `clientSocket.unshift(head)` if the original CONNECT carried trailing bytes.
- **WHY:** any other order causes the client to misframe the TLS handshake and drop the connection.

#### Scenario: TLS server is closed when the client disconnects
- **WHEN** the client socket fires `close`
- **THEN** the per-host `tlsServer.close()` runs, releasing the listener — preventing fd accumulation across the lifetime of the proxy.

### Request rewriting (TLS-decrypted)

#### Scenario: Headers are buffered until `\r\n\r\n` arrives
- **WHEN** the agent's HTTPS client streams the decrypted request through the MITM tunnel
- **THEN** the proxy concatenates chunks until it sees the header terminator, *pauses* the socket, parses the header section, then resumes after wiring the upstream socket.
- **AND** a `handled` boolean ensures the parse runs exactly once even if extra data chunks arrive during parsing.

#### Scenario: Body is forwarded verbatim
- **WHEN** the request includes a body (POST/PUT)
- **THEN** the bytes after `\r\n\r\n` in the buffered data are written to the upstream socket along with the rewritten headers; subsequent chunks pipe through unmodified.
- **AND** the response is piped back through the TLS server to the agent — no response-side rewriting.

### Transparent passthrough (non-intercepted hosts)

#### Scenario: Non-intercepted hosts get a raw TCP pipe
- **WHEN** `shouldIntercept(host)` is false
- **THEN** the proxy opens a plain `net.Socket` to the remote, writes `200 Connection Established` to the client, and `pipe()`s in both directions — no TLS termination, no inspection.
- **AND** errors on either side destroy the other socket, propagating the failure cleanly.

### CA management (`credential-proxy-ca.ts`)

#### Scenario: CA is generated once per process and cached in memory
- **WHEN** `generateCA()` is called multiple times
- **THEN** the first call runs `selfsigned.generate({ days: 3650, keySize: 2048, extensions: [basicConstraints{cA:true}, keyUsage{keyCertSign,cRLSign}] })` and caches the result in `cachedCA`.
- **AND** subsequent calls return the cached pair.

#### Scenario: CA cert is written to a temp file for `NODE_EXTRA_CA_CERTS`
- **WHEN** the proxy starts
- **THEN** `writeCACertFile()` creates a `mkdtempSync(${tmpdir()}/inbox-proxy-ca-)` directory, writes `ca.pem`, and returns the path.
- **WHY:** `NODE_EXTRA_CA_CERTS` requires a file path; the agent subprocess (which we spawn) reads it at startup to extend its trust store.

#### Scenario: Per-host certs include SAN for the host
- **WHEN** `generateCertForHost("api.notion.com", ca)` runs
- **THEN** the resulting cert has `commonName: api.notion.com` and `subjectAltName: [DNS:api.notion.com]`, signed by the proxy CA — so Node accepts it under hostname verification.

### `getProxyEnv` contract

#### Scenario: Four env vars are returned per session token
- **WHEN** the caller passes a `sessionToken`
- **THEN** `getProxyEnv(token)` returns `{ HTTPS_PROXY: "http://${token}@127.0.0.1:${port}", NO_PROXY: "<bypass list>", NODE_EXTRA_CA_CERTS: caCertPath, NODE_OPTIONS: "<existing>... --import \"${PRELOAD_SCRIPT}\"" }`.
- **AND** any existing `process.env.NODE_OPTIONS` is preserved (prepended) so caller-set options aren't dropped.

#### Scenario: `NO_PROXY` bypasses Anthropic API and telemetry hosts
- **WHEN** `getProxyEnv(token)` is called
- **THEN** `NO_PROXY` includes `.anthropic.com` (and other non-intercepted infra hosts the agent binary reaches) so traffic to the Claude API skips the proxy entirely.
- **WHY:** The Bun-compiled native binary shipped in `@anthropic-ai/claude-agent-sdk` ≥0.2.138 mis-handles the local CONNECT tunnel for HTTPS targets, failing with a spurious `Unable to connect to API (ConnectionRefused / FailedToOpenSocket)`. The proxy adds no value for `api.anthropic.com` (it's not on the intercept allowlist — just a transparent pipe), so bypassing it lets the binary connect directly using its keychain-stored OAuth.

### Agent preload (`agent-proxy-preload.mjs`)

#### Scenario: `undici` global dispatcher is configured from `HTTPS_PROXY`
- **WHEN** the agent subprocess starts with `HTTPS_PROXY` set
- **THEN** the preload parses `process.env.HTTPS_PROXY`, builds a `ProxyAgent({ uri: "${protocol}//${host}", token: "Basic " + base64("${user}:") })`, and calls `setGlobalDispatcher(...)`.
- **WHY:** `undici` (Node's built-in `fetch()`) does not read `HTTPS_PROXY` from env and ignores userinfo in the URI — both must be wired manually.

#### Scenario: Preload is a `.mjs` file, not `.ts` or `.js`
- **WHEN** `--import` resolves the preload
- **THEN** the file is `agent-proxy-preload.mjs` so Node treats it as an ES module independent of any `package.json` `type` field, and no transpile step is needed at agent-spawn time.

#### Scenario: Preload is a no-op when `HTTPS_PROXY` is unset
- **WHEN** `process.env.HTTPS_PROXY` is missing
- **THEN** the preload does nothing — agents spawned without proxying (e.g. in test) get unmodified `fetch()` behaviour.

## Technical Notes

| Concern | Location |
|---|---|
| MITM proxy server, CONNECT handling, header/URL rewriting, integration auth dispatch, `getProxyEnv` | [server/lib/credential-proxy.ts](../../../server/lib/credential-proxy.ts) |
| Self-signed CA + per-host cert generation with LRU cache, CA file writer | [server/lib/credential-proxy-ca.ts](../../../server/lib/credential-proxy-ca.ts) |
| Agent-subprocess preload that wires `undici`'s global dispatcher to the proxy | [server/lib/agent-proxy-preload.mjs](../../../server/lib/agent-proxy-preload.mjs) |
| Tests: header-rewrite, query-param, Basic, missing-cred, CA caching, end-to-end through real `undici` | [server/lib/__tests__/credential-proxy.test.ts](../../../server/lib/__tests__/credential-proxy.test.ts), [server/lib/__tests__/credential-proxy-ca.test.ts](../../../server/lib/__tests__/credential-proxy-ca.test.ts), [server/lib/__tests__/credential-proxy-integration.test.ts](../../../server/lib/__tests__/credential-proxy-integration.test.ts) |

## History

- Original implementation only supported Bearer; Shopify shipped first as a one-off branch with a custom header. Generalising to `INTEGRATION_AUTH` as a discriminated map removed the branch and made adding Klaviyo/Gorgias/Meta a one-line change each.
- Query-param injection (`meta`, `gemini`) replaced an attempt to add `Authorization: Bearer` headers to those APIs — they ignore the header and only honour the URL param, so the previous code path silently no-op'd auth.
- The `200 Connection Established`-before-`emit` ordering was discovered after intermittent agent-side TLS handshake failures on slow CI machines; locally the race never manifested.
- Per-host cert LRU cap added after a long-running agent generated 4,000+ certs for unique Shopify shop subdomains over a weekend, leaking ~150 MB.
- The `agent-proxy-preload.mjs` route was preceded by a per-skill `setGlobalDispatcher` snippet copied into every skill — a maintenance hazard. Centralising via `NODE_OPTIONS=--import` means skills are credential-config-free.
- Session token extraction originally only supported `Bearer`; switched to also accept `Basic <user:>` after `undici`/curl/python all naturally encoded userinfo as Basic when given `HTTPS_PROXY=http://token@host`.
- `NO_PROXY` added (2026-05-11) bypassing `.anthropic.com` and other non-intercepted infra hosts. `@anthropic-ai/claude-agent-sdk` ≥0.2.138 swapped its Node-based CLI for a Bun-compiled native binary whose HTTP client mis-handles the local CONNECT tunnel for HTTPS targets — surfacing as `Unable to connect to API (ConnectionRefused / FailedToOpenSocket)` even though curl through the same proxy URL succeeds. Since `api.anthropic.com` was only ever transparent-tunneled (not on the intercept allowlist), bypassing the proxy entirely is the right answer.
