# Webhooks

## Purpose

Provide one signed ingress route at `/api/webhooks/:pluginId`. The route is
CSRF-exempt because providers are not browsers, but it is never
unauthenticated: it verifies freshness and a signature over the exact raw body
before JSON decoding or dispatch.

## Context

### Why a single dispatcher

Plugins register their own data and UI surfaces, while ingress URL, replay, and
failure semantics are platform concerns. A stable dispatcher keeps those
security rules consistent as providers are added.

### Slack and generic signatures

Slack requests use `X-Slack-Signature` and
`X-Slack-Request-Timestamp` with Slack's `v0` HMAC construction. Other providers
use the platform `X-Hammies-Signature`, `X-Hammies-Timestamp`, and
`X-Hammies-Event-Id` headers. Timestamps have a five-minute window.

### Unsupported events

Per-plugin mutation dispatch remains a later feature. A verified event that has
no dispatcher returns an explicit `unsupported-event` outcome with HTTP 202,
rather than claiming the mutation was processed. Event IDs are claimed for the
process lifetime to suppress immediate retries.

## Requirements

### URL verification

#### Scenario: Slack `url_verification` payloads are echoed

- **WHEN** a correctly signed Slack verification payload is received
- **THEN** the response includes contract version 1 and its challenge.

### Signed ingress

#### Scenario: Unsupported signed events are explicitly acknowledged

- **WHEN** a correctly signed event reaches a provider without a dispatcher
- **THEN** the route returns 202 with `outcome: "unsupported-event"`.

#### Scenario: Invalid signatures are rejected before JSON parsing

- **WHEN** signature verification fails, even if the body is malformed JSON
- **THEN** the route returns 401 without decoding or logging the payload.

#### Scenario: Auth middleware does not gate this route

- **WHEN** a signed webhook arrives without an `inbox_session` cookie
- **THEN** signature authentication is sufficient and cookie auth is not
  applied.

### Mount point

#### Scenario: Mounted at `/api/webhooks`

- **WHEN** the server boots
- **THEN** `webhookRoutes` is mounted at `/api/webhooks` and the CSRF
  exemption uses the same prefix.

## Technical Notes

| Concern | Location |
|---|---|
| Raw signature verification, payload schemas, replay claims, and outcomes | [server/routes/webhooks.ts](../../../server/routes/webhooks.ts) |

## History

- Endpoint introduced as a passthrough so Slack URL verification could be
  completed during plugin development.
- 2026-07-27: Added raw-body HMAC verification, freshness limits, runtime
  payload schemas, replay outcomes, and explicit unsupported-event handling.
