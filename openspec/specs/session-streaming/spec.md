# Session Streaming Protocol

## Purpose

Real-time delivery of agent-session events from the inbox server to a browser tab, with at-least-once-then-deduplicated semantics and transparent recovery from gaps, reconnects, and server restarts. The spec defines the wire protocol on `/api/ws`, the server-side broadcast buffer that backs cursor replay, and the client-side recovery state machine that restores a consistent transcript when the buffer can't.

This spec covers **only the streaming transport and recovery contract** — the full session lifecycle (create, resume, ask-user-question, JSONL storage) is owned by other specs and referenced where they cross this boundary.

## Context

### Why a multiplexed WebSocket
A single WebSocket per browser tab carries events for every session that tab is watching. SSE was rejected because (a) we need bidirectional control frames (subscribe / unsubscribe / ping) and (b) per-session SSE connections would multiply rapidly when a user opens a session list. WebSockets also let us implement keepalive ourselves, which we need because `ws.onclose` can take minutes to fire on silently dead connections (laptop sleep, NAT drop).

### Why an in-memory broadcast buffer + cursor recovery instead of full event sourcing on disk
The Agent SDK already writes every event to a per-session JSONL file at `~/.claude/projects/{encoded-cwd}/{sessionId}.jsonl` — that is the durable record. The broadcast buffer is a *recent-window cache* that exists for one purpose: a client that drops and reconnects within seconds shouldn't have to refetch the full transcript. When the cache can't satisfy the gap (server restart, slow client, very long session), the client falls back to a REST snapshot of the JSONL, which is the same path used at initial bootstrap. Treating snapshot-fallback as a routine recovery, not an exception, is what makes the rest of the design simple.

### Why a separate recovery state machine on the client
The combination of StrictMode double-invocation, multi-tab usage, mid-stream gaps, and reconnect storms produced cycles of subtle bugs (snapshot-in-flight tokens leaking, events deferred forever, sequences applied out of order). Pulling the classification logic into a pure state machine (`session-recovery.ts`) — separate from the Zustand store, separate from React, separately testable — was the only structure that survived a chaos test. The store and reducers are pure functions over the slice; the coordinator is the only thing that decides whether to apply, defer, ignore, or recover.

### Sequence numbers
Sequences are monotonic and assigned by the server. The live broadcaster's counter is the source of truth: it starts at `0` for new sessions and at `jsonlLines.length` on resume, so the next event's `sequence` always equals `prior + 1`.

Per-message `sequence` values inside the REST snapshot's `messages` array can be **sparse** — non-display JSONL lines (`system`, `summary`) are filtered out, thinking blocks use fractional offsets (`lineIdx + (ti+1) * 0.001`) so the UI can render them on their own lines, and subagent merging may renumber. The snapshot response therefore carries an explicit `latestSequence` field — equal to `jsonlLines.length - 1` — that the client uses as the recovery cursor. Trusting `messageIds[last]` instead would leave the coordinator's `latestSequence` below what the broadcaster will emit and trigger a snapshot/recover loop on every live event.

## Requirements

### Server exposes a single WebSocket endpoint

#### Scenario: Client opens the connection
- **WHEN** a client sends `GET /api/ws` with the WebSocket upgrade headers
- **THEN** the server MUST accept the upgrade, allocate a `clientId`, and immediately send `{ type: "connected", clientId }`.

#### Scenario: Client must authenticate via session cookie
- **WHEN** the upgrade request lacks a valid `inbox_session` cookie
- **THEN** the server MUST reject the upgrade.

### Subscribe handshake supports per-session cursors

#### Scenario: Subscribing with a cursor requests replay
- **WHEN** the client sends `{ type: "subscribe", sessions: [{ id, fromSequence }, ...] }` with `fromSequence` a positive integer
- **THEN** the server MUST replay every buffered event for that session whose `sequence > fromSequence`, in ascending order, before any new events.

#### Scenario: Subscribing without a cursor requests no replay
- **WHEN** the client sends `{ type: "subscribe", sessions: [{ id }] }` (no `fromSequence`) OR the legacy `{ type: "subscribe", sessionIds: [...] }`
- **THEN** the server MUST NOT replay buffered events; the client receives only events broadcast after this subscribe.

#### Scenario: Cursor older than buffer triggers cursor_miss
- **WHEN** `fromSequence` is older than the oldest entry in that session's broadcast buffer
- **THEN** the server MUST send `{ type: "cursor_miss", sessionId }` and MUST NOT replay any buffered events for that session.

#### Scenario: Terminal state always replays on subscribe
- **WHEN** a session's status is `complete`, `errored`, or `awaiting_user_input`
- **THEN** the server MUST send the corresponding terminal event (`session_complete`, `session_error`, or `ask_user_question`) on subscribe, even when no cursor is provided.
- **WHY** A client connecting after the session ended must still see the right end-state without polling.

#### Scenario: Unsubscribing removes server-side fanout
- **WHEN** the client sends `{ type: "unsubscribe", sessionIds: [...] }`
- **THEN** the server MUST stop fanning out events for those sessions to that client until the client subscribes again.

### Wire format distinguishes sequenced from lifecycle events

#### Scenario: Sequenced message events carry sequence + message
- **WHEN** the agent yields a transcript message
- **THEN** the server MUST broadcast `{ type: "session_event", sessionId, data: { sequence, message } }` where `sequence` is monotonically increasing per session and equal to the prior broadcast's sequence + 1.

#### Scenario: REST snapshot carries an explicit latestSequence cursor
- **WHEN** the client fetches `GET /api/sessions/:id`
- **THEN** the response MUST include a `latestSequence: number` field equal to `max(0, jsonlLines.length - 1)` for that session.
- **AND** the client MUST use this value (taking the max with `messageIds[last]`) as the coordinator's `latestSequence`, not the highest per-message `sequence` in the `messages` array.
- **WHY** Per-message sequences in the snapshot are sparse — non-display JSONL lines are filtered, thinking blocks use fractional offsets, subagents are renumbered. Without the explicit cursor, the coordinator's `latestSequence` lags the live broadcaster's counter and every post-resume event classifies as `recover`, producing an infinite snapshot-fetch loop.

#### Scenario: Lifecycle events have no sequence
- **WHEN** the server broadcasts a lifecycle transition (`session_complete`, `session_error`, `ask_user_question`, `presence`)
- **THEN** the event MUST NOT include a `sequence` field.
- **AND** the server MUST NOT push lifecycle events into the broadcast buffer; they are re-derived from DB and presence state on subscribe.

### Broadcast buffer caches recent sequenced events

#### Scenario: Buffer is per-session and bounded
- **WHEN** the server broadcasts a sequenced event for a session
- **THEN** the event MUST be appended to that session's in-memory ring buffer.
- **AND** the buffer MUST be capped at `BROADCAST_BUFFER_CAPACITY = 500`; oldest entries are dropped when the cap is reached.

#### Scenario: Buffer is dropped on terminal status
- **WHEN** a session transitions to status `complete`, `errored`, or `archived`
- **THEN** the server MUST drop that session's broadcast buffer.
- **WHY** Buffers are recovery-window caches, not durable storage; long-lived server processes must not accumulate buffers for finished sessions.

#### Scenario: Server restart wipes all buffers
- **WHEN** the server process restarts
- **THEN** all broadcast buffers are lost; reconnecting clients with a `fromSequence` MUST receive `cursor_miss` and fall back to a REST snapshot.

### Keepalive uses application-level ping/pong with watchdog

#### Scenario: Client pings on a fixed interval
- **WHEN** the WebSocket is open
- **THEN** the client MUST send `{ type: "ping" }` every `PING_INTERVAL_MS = 20_000`.

#### Scenario: Server replies with pong
- **WHEN** the server receives `{ type: "ping" }`
- **THEN** the server MUST reply `{ type: "pong" }`.

#### Scenario: Client force-closes on silent connection
- **WHEN** no inbound frame (any frame, including `pong`) has arrived for `ALIVE_TIMEOUT_MS = 45_000`
- **THEN** the client MUST force-close the socket and trigger the reconnect path.
- **WHY** Catches dead connections that `ws.onclose` would otherwise take minutes to surface (laptop sleep, NAT/proxy drops).

### Client reconnects with exponential backoff and resubscribes with cursors

#### Scenario: Reconnect uses bounded exponential backoff
- **WHEN** the WebSocket closes for any reason
- **THEN** the client MUST reconnect with delays `1s, 2s, 4s, …` capped at `30s`.

#### Scenario: Resubscribe uses the latest applied sequence
- **WHEN** the WebSocket reopens and the client has active per-session subscriptions
- **THEN** the client MUST send a single `subscribe` frame containing each session's current `latestSequence` as `fromSequence` (or omit `fromSequence` for sessions with no prior state).

### Client recovery coordinator classifies every inbound event

The recovery coordinator (`session-recovery.ts`) is a pure state machine. The store consults it for every inbound event before any reducer applies state.

#### Scenario: Duplicate event is ignored
- **WHEN** an event arrives with `sequence <= latestSequence`
- **THEN** classification MUST be `ignore` and no state changes.

#### Scenario: Event during snapshot-in-flight is deferred
- **WHEN** an event arrives while `bootstrapped === false` OR an `inFlight` snapshot is running
- **THEN** classification MUST be `defer`; the event is buffered in `deferredEvents` until the snapshot completes.

#### Scenario: Sequence gap triggers recovery
- **WHEN** an event arrives with `sequence !== latestSequence + 1` and no snapshot is in flight
- **THEN** classification MUST be `recover`; the client schedules a snapshot fetch.

#### Scenario: Exact next-sequence event applies
- **WHEN** an event arrives with `sequence === latestSequence + 1` and no snapshot is in flight
- **THEN** classification MUST be `apply`; the reducer ingests it and `latestSequence` advances by 1.

#### Scenario: cursor_miss invalidates bootstrap
- **WHEN** the server sends `{ type: "cursor_miss", sessionId }`
- **THEN** the coordinator MUST roll `bootstrapped` to `false` AND set `pendingReplay` to `true`, causing the next render to fetch a fresh snapshot.

#### Scenario: Snapshot lifecycle follows begin → (complete | fail)
- **WHEN** `beginSnapshotRecovery(reason)` is called
- **THEN** if no snapshot is in flight, `inFlight` is set and the call returns `true`; otherwise it returns `false` and no new snapshot starts.
- **AND** every successful `beginSnapshotRecovery` MUST be paired with exactly one `completeSnapshotRecovery` or `failSnapshotRecovery` call.
- **WHY** Leaking the `inFlight` token causes every subsequent event to be classified `defer` forever — the worst observable bug class for this subsystem.

#### Scenario: Failed snapshot does not retry indefinitely
- **WHEN** `failSnapshotRecovery()` is called
- **THEN** both `inFlight` AND `pendingReplay` MUST be cleared, so the system does not loop on a persistent backend error.

### Deferred events are bounded

#### Scenario: Deferred buffer caps at MAX_DEFERRED_EVENTS
- **WHEN** the deferred-event count for a session reaches `MAX_DEFERRED_EVENTS = 500`
- **THEN** the oldest deferred event MUST be dropped AND `pendingReplay` MUST be set so the gap effect refetches a clean snapshot.
- **WHY** Defense-in-depth for persistent-gap pathologies — better to drop and resync than to accumulate forever.

### Inbound events are coalesced per animation frame

#### Scenario: Bursts of events commit as one store transition
- **WHEN** the WS receives multiple `session_event` messages within a single animation-frame window (e.g. broadcast-buffer replay on subscribe, or rapid live emission)
- **THEN** the client MUST buffer the events and call `useSessionStore.ingestEventBatch(sessionId, events)` once per frame instead of `ingestEvent` per message.
- **AND** the store MUST commit exactly one `set()` per batch — subscribers re-render once, not N times.
- **WHY:** A flood of N back-to-back `set()` calls — typical of server replay on a large session — pins the main thread, allocates N new slice objects, and trips React's Maximum-update-depth guard before the browser yields. Batching collapses the burst into one render.

#### Scenario: All-ignore batches skip the slice mutation
- **WHEN** every event in a batch classifies as `ignore` (already-applied sequences)
- **THEN** the store MUST NOT allocate a new slice object; it MUST mirror only the coordinator's recovery state via `syncRecoveryState`, which short-circuits when nothing changed.

### Snapshot recovery has a circuit breaker

#### Scenario: Coordinator gives up after N unsatisfied snapshots in a row
- **WHEN** `completeSnapshotRecovery` returns with `highestObservedSequence > latestSequence` `MAX_CONSECUTIVE_UNSATISFIED_SNAPSHOTS = 3` times in a row (no intervening successful `markEventBatchApplied`)
- **THEN** the coordinator MUST pin `highestObservedSequence` to `latestSequence` AND clear `pendingReplay`, so the React effect stops re-firing snapshots.
- **AND** `isCircuitOpen()` MUST return `true` until the next successful apply or `invalidateBootstrap`.
- **WHY** When the snapshot source (REST endpoint reading JSONL/DB) cannot catch up to the broadcaster (in-memory queue emitting ahead of persisted state), deferred events keep re-arming `pendingReplay`, the gap effect keeps firing snapshots, and the store keeps allocating fresh slice objects — heap explodes and the renderer dies with `SBOX_FATAL_MEMORY_EXCEEDED`. Better to leave the client at a slightly stale snapshot than to crash.

#### Scenario: Open breaker drops deferred events during applySnapshot
- **WHEN** `applySnapshot` runs with `coord.isCircuitOpen() === true`
- **THEN** the deferred-event flush loop MUST be skipped and `workingSlice.deferredEvents` MUST be set to `[]`.
- **WHY** Re-classifying deferred events whose sequence the snapshot still cannot satisfy would set `pendingReplay` again and restart the loop.

### Reliability invariants

These MUST hold at every store transition. They are enforced by the seeded chaos test (5 seeds × 1000 random actions).

#### Scenario: messageIds is sorted and unique
- **WHEN** any reducer returns a new slice
- **THEN** `messageIds` MUST be ascending with no duplicates.

#### Scenario: messageById matches messageIds
- **WHEN** any reducer returns a new slice
- **THEN** `Object.keys(messageById).map(Number).sort()` MUST equal `messageIds`.

#### Scenario: latestSequence never decreases
- **WHEN** any reducer or coordinator transition completes
- **THEN** `recovery.latestSequence` MUST be `>=` its prior value.

#### Scenario: inFlight token follows protocol
- **WHEN** a snapshot is begun, completed, or failed
- **THEN** `inFlight` MUST be set iff exactly one snapshot is currently running.

## Technical Notes

### Server

| Requirement | Implementation |
|---|---|
| Server exposes a single WebSocket endpoint | ``server/index.ts:30`` — imports; `server/index.ts:314-327` — message dispatch |
| Subscribe handshake supports per-session cursors | `server/index.ts:314-325`; cursor handling delegates to ``server/lib/session-manager.ts`` `wsSubscribe` |
| Wire format (sequenced events) | ``server/lib/session-manager.ts`` `broadcastToSession` |
| REST snapshot carries latestSequence cursor | ``server/lib/session-manager.ts`` `getSessionJsonlLineCount`; ``server/routes/sessions.ts`` GET `/:id` |
| Wire format (lifecycle events not buffered) | `server/lib/session-manager.ts:588-592` — buffer comment |
| Broadcast buffer cap = 500 | ``server/lib/session-manager.ts:592`` — `BROADCAST_BUFFER_CAPACITY` |
| Buffer dropped on terminal status | ``server/lib/session-manager.ts`` — search for buffer-drop on status transition |
| Keepalive (server pong) | `server/index.ts:326-327` |

### Client

| Requirement | Implementation |
|---|---|
| Resubscribe with cursors on reconnect | [`src/hooks/use-ws-stream.tsx:109-138`](../../../src/hooks/use-ws-stream.tsx#L109-L138) — subscribe frame builder; [`:195-204`](../../../src/hooks/use-ws-stream.tsx#L195-L204) — onopen path |
| Ping interval = 20s, alive timeout = 45s | [`src/hooks/use-ws-stream.tsx:12-13`](../../../src/hooks/use-ws-stream.tsx#L12-L13) |
| Force-close watchdog | [`src/hooks/use-ws-stream.tsx:99-107`](../../../src/hooks/use-ws-stream.tsx#L99-L107) |
| Exponential backoff capped at 30s | [`src/hooks/use-ws-stream.tsx:236-239`](../../../src/hooks/use-ws-stream.tsx#L236-L239) |
| cursor_miss handling | [`src/hooks/use-ws-stream.tsx:206`](../../../src/hooks/use-ws-stream.tsx#L206) — frame dispatch; [`src/stores/session-recovery.ts:154`](../../../src/stores/session-recovery.ts#L154) — invalidateBootstrap |
| Recovery classification (ignore/defer/recover/apply) | [`src/stores/session-recovery.ts`](../../../src/stores/session-recovery.ts) — `classifyEvent` |
| Snapshot begin → (complete \| fail) protocol | [`src/stores/session-recovery.ts`](../../../src/stores/session-recovery.ts) — `beginSnapshotRecovery`, `completeSnapshotRecovery`, `failSnapshotRecovery` |
| Snapshot-loop circuit breaker (`MAX_CONSECUTIVE_UNSATISFIED_SNAPSHOTS`) | [`src/stores/session-recovery.ts`](../../../src/stores/session-recovery.ts) — `isCircuitOpen` + `resolveReplayNeed`; [`src/stores/session-store.ts`](../../../src/stores/session-store.ts) — `applySnapshot` flush skip |
| Bounded deferred events (cap = 500) | [`src/stores/session-store.ts:22`](../../../src/stores/session-store.ts#L22), [`:134-147`](../../../src/stores/session-store.ts#L134-L147) |
| Per-session orchestration hook | [`src/hooks/use-session-transcript.ts`](../../../src/hooks/use-session-transcript.ts) |
| Event-batching queue (rAF drain) | [`src/hooks/use-session-transcript.ts`](../../../src/hooks/use-session-transcript.ts) — subscribe-callback queue + `drain`; [`src/stores/session-store.ts`](../../../src/stores/session-store.ts) — `ingestEventBatch` |
| applySnapshot uses server-supplied latestSequence cursor | [`src/stores/session-store.ts`](../../../src/stores/session-store.ts) — `applySnapshot` `snapshotHigh` computation |
| WebSocket connection store (single source of truth for UI connectivity) | [`src/stores/ws-connection-store.ts`](../../../src/stores/ws-connection-store.ts) |

### Tests

- Chaos test (reliability invariants): `src/stores/__tests__/session-store.chaos.test.ts` — 5 seeds × 1000 random actions.
- Recovery coordinator unit tests: `src/stores/__tests__/session-recovery.test.ts`.
- Multi-tab Playwright smoke test: `tests/e2e/session-multi-tab.spec.ts` — guards the StrictMode / inFlight-leak class of bugs.

### Crosses with other specs

- **Session lifecycle** (create/resume/ask-user-question, JSONL storage, agent SDK integration) — referenced but not specified here.
- **API and database** — REST snapshot endpoint used as recovery fallback.
- **Optimistic prompts** — interacts with this protocol via real-message reconciliation in `reduceEvent`/`reduceSnapshot`.

## History

| Date | Commit | Change |
|------|--------|--------|
| 2026-05-24 | _pending_ | Coalesce WS event bursts into one store transition. Heartbeat telemetry caught a render storm on a long-transcript session: opening it via `/recent/sessions/…` triggered broadcast-buffer replay (hundreds of events in one tick), each `ingestEvent` produced a separate `set()`, React saw the same fiber re-queue too many times and threw "Maximum update depth exceeded" (2013 long-tasks-per-5s, heap climbing past 800 MB). Added `ingestEventBatch` to the store and a `requestAnimationFrame` drain in `use-session-transcript`; bursts now commit as a single re-render. |
| 2026-05-24 | _pending_ | Add snapshot-loop circuit breaker. Crash telemetry (heartbeat.jsonl) showed sustained 130+ long-tasks-per-5s and heap climbing past 1.1 GB on a specific session — root cause: snapshot endpoint couldn't reach broadcaster-emitted sequences, so deferred events kept re-arming `pendingReplay` after every `completeSnapshotRecovery`, the React gap effect kept firing snapshots, and each iteration allocated new slice objects until the renderer crashed. Coordinator now opens a breaker after 3 consecutive unsatisfied snapshots; `applySnapshot` skips the deferred-event flush when the breaker is open. |
| 2026-05-08 | _pending_ | Add explicit `latestSequence` cursor to the REST snapshot. Per-message `sequence` values can be sparse (filtered JSONL lines, thinking fractionals, subagent renumbering) so trusting `messageIds[last]` left the client coordinator behind the live broadcaster's counter, causing every post-resume event to classify as `recover` and producing an infinite snapshot-fetch loop. Server now reports `jsonlLines.length - 1`; client takes `max(messageIds[last], latestSequence)` in `applySnapshot`. |
| 2026-05-05 | _pending_ | Initial OpenSpec port — narrowed scope from `docs/session-architecture.md` to streaming protocol + recovery contract only. Other concerns (session lifecycle, optimistic prompts, transcript rendering) deferred to their own specs. Constants verified against code: `BROADCAST_BUFFER_CAPACITY=500`, `PING_INTERVAL_MS=20_000`, `ALIVE_TIMEOUT_MS=45_000`, `MAX_DEFERRED_EVENTS=500`. No behavior change. |
