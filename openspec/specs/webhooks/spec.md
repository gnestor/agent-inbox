# Webhooks

## Purpose

Provide a single ingress route `/api/webhooks/:pluginId` for third-party webhook deliveries. The route is CSRF-exempt (third-party POSTs cannot send a same-origin Origin header) and currently a passthrough — it acknowledges receipt and logs the payload, with per-plugin dispatch reserved for future work.

## Context

### Why CSRF-exempt
Webhook senders (Slack, Notion, Gmail push) are not browsers and do not present an `Origin` header that matches the inbox's allowlist. The CSRF middleware exempts paths starting with `/api/webhooks` for that reason — see `auth-and-sessions` spec.

### Why a single dispatcher rather than per-plugin routes
Plugins register their own auth/scopes/UI, but webhook ingress shape (URL, JSON body, ack response) is uniform. A single route keeps the URL contract stable for third parties even as plugins are added/removed.

### Slack URL-verification handshake
Slack requires the endpoint to echo back a `challenge` value in response to a `type: "url_verification"` payload before it will activate event delivery. The route handles this inline without dispatching to a plugin, because the verification arrives before any plugin context exists.

### Current limitations
The route logs and returns `{ ok: true }`. Per-plugin dispatch (`plugin.webhookHandler()`) is a stub marked `TODO` in code — when implemented it must verify the sender's signature *before* invoking plugin code.

## Requirements

### URL verification

#### Scenario: Slack `url_verification` payloads are echoed
- **WHEN** `POST /api/webhooks/:pluginId` is called with body `{ type: "url_verification", challenge }`
- **THEN** the route returns `{ challenge }` immediately without any plugin dispatch.
- **WHY:** Slack will not enable event delivery until the endpoint passes this handshake.

### Generic ingress

#### Scenario: Any other payload is acknowledged
- **WHEN** a webhook POST arrives that is not URL verification
- **THEN** the route logs the first 200 chars of the JSON body tagged with `[webhook:<pluginId>]` and returns `{ ok: true }` with HTTP 200.
- **AND** the route does NOT yet dispatch into the plugin — `plugin.webhookHandler()` is a planned extension.

#### Scenario: Auth middleware does not gate this route
- **WHEN** a webhook POST arrives without an `inbox_session` cookie
- **THEN** the request is processed; `/api/webhooks` is mounted before the auth middleware does NOT apply (CSRF middleware also exempts the path).

### Mount point

#### Scenario: Mounted at `/api/webhooks`
- **WHEN** the server boots
- **THEN** `webhookRoutes` is mounted at `/api/webhooks` and the CSRF middleware's `exemptPaths` list includes the same prefix.

## Technical Notes

| Concern | Location |
|---|---|
| Webhook route + URL verification handler | [server/routes/webhooks.ts](../../../server/routes/webhooks.ts) |
| Mount point | [server/index.ts:340](../../../server/index.ts#L340) |
| CSRF exemption list (must include `/api/webhooks`) | [server/index.ts:250-253](../../../server/index.ts#L250-L253) |

## History

- Endpoint introduced as a passthrough so Slack URL verification could be completed during plugin development.
- Per-plugin dispatch and signature verification deferred — will land alongside the first plugin that needs inbound events.
