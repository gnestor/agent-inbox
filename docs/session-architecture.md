# Session Architecture

Sessions are Claude Code agent runs managed by the inbox server. They're started from an email thread, task, or directly; tracked in real-time via a multiplexed WebSocket; resumed with follow-up prompts; and browsed after completion. Transcript state on the client is event-sourced through a per-session recovery coordinator that handles WebSocket gaps, reconnects, and snapshot fallbacks transparently.

## Data model

The `sessions` table holds **metadata only**. The transcript itself lives in JSONL files written by the Agent SDK at `~/.claude/projects/{encoded-cwd}/{sessionId}.jsonl` — the same format Claude Code CLI uses. Every event the SDK emits is one line in that file; sequence numbers used over the wire correspond to line indexes.

```
sessions
─────────────────────────────────
id                TEXT PRIMARY KEY
status            TEXT  -- running | complete | errored | awaiting_user_input | archived
prompt            TEXT
summary           TEXT
started_at        TEXT
updated_at        TEXT
completed_at      TEXT
linked_source_type TEXT
linked_source_id  TEXT
trigger_source    TEXT
metadata          TEXT (JSON)
```

There is no `session_messages` table. Reads of the full transcript go through `getAgentSessionTranscript(sessionId, cwd)` which reads + parses the JSONL plus any subagent JSONLs and returns a sequence-indexed array.

## Realtime transport: multiplexed WebSocket

A single WebSocket per browser tab carries events for every session that tab is watching. There is no SSE.

**Endpoint:** `GET /api/ws` (upgraded by `@hono/node-ws`). On open, the server sends `{ type: "connected", clientId }`; the client tracks the clientId and sends a subscribe message for any sessions it currently has listeners for.

### Subscribe handshake

```ts
// New shape (preferred): per-session cursor
{ type: "subscribe", sessions: [{ id, fromSequence?: number }, ...] }

// Legacy shape (still accepted): no cursor, no replay
{ type: "subscribe", sessionIds: [string, ...] }
```

When `fromSequence` is present, the server replays any events with `sequence > fromSequence` from its in-memory broadcast buffer (see below). If the cursor is older than the buffer's oldest entry, the server sends `{ type: "cursor_miss", sessionId }` and the client falls back to a full REST snapshot. After the cursor replay (or instead of it, for legacy subscribers), the server replays the session's terminal state — `session_complete`, `session_error`, or `ask_user_question` — so a client that connected after the session ended still sees the right end-state.

### Wire format

Sequenced message events:
```json
{ "type": "session_event", "sessionId": "…", "data": { "sequence": 42, "message": { "type": "assistant", "content": [...] } } }
```

Lifecycle events (no sequence, not buffered):
```json
{ "type": "session_event", "sessionId": "…", "data": { "type": "session_complete", "status": "complete" } }
{ "type": "session_event", "sessionId": "…", "data": { "type": "session_error",   "error":  "..." } }
{ "type": "session_event", "sessionId": "…", "data": { "type": "ask_user_question", "questions": [...] } }
{ "type": "session_event", "sessionId": "…", "data": { "type": "presence", "users": [...] } }
```

Connection-level frames:
```json
{ "type": "connected", "clientId": "…" }
{ "type": "cursor_miss", "sessionId": "…" }
{ "type": "ping" }   // client → server, every 20 s
{ "type": "pong" }   // server → client
```

### Broadcast buffer

The server keeps an in-memory ring buffer per session, capped at `BROADCAST_BUFFER_CAPACITY` (500) sequenced broadcasts. `broadcastToSession` pushes every `{ sequence, message }` payload into the buffer before fanning out to live clients. Buffers are dropped on `complete` / `errored` / `archived` status transitions to avoid leaking memory across long-lived server processes. Server restarts wipe the buffer; reconnecting clients get `cursor_miss` and fall back to a full snapshot, which is the same recovery path as today.

Lifecycle events are *not* buffered; they're rederived on subscribe from the DB record and presence map.

### Keepalive

The client pings every 20 s and force-closes the socket if no inbound traffic (any frame, including `pong`) lands within 45 s. This catches silently dead connections (laptop sleep, NAT/proxy drops) where `ws.onclose` would otherwise be delayed for minutes. The force-close triggers the existing reconnect path (exponential backoff up to 30 s).

## Client state: event-sourced Zustand store

State is normalised per-session in a single store and never duplicated. WebSocket events are routed through a per-session recovery coordinator before any reducer can apply them.

### Layers (each pure, separately testable)

1. **`session-recovery.ts`** — pure state machine. Classifies every inbound event as `ignore` / `defer` / `recover` / `apply`. Owns the begin → (complete | fail) snapshot lifecycle. No React, no I/O.
2. **`session-reducer.ts`** — pure reducers over a `SessionSlice`: `reduceSnapshot`, `reduceEvent`, `reduceOptimisticPrompt`, `reduceClearPendingQuestion`. No coordinator, no store.
3. **`session-store.ts`** — Zustand store keyed by sessionId. Each store action consults the per-session coordinator, then calls a reducer. Rich actions: `ingestEvent`, `applySnapshot`, `beginSnapshot`, `failSnapshot`, `submitOptimisticPrompt`, `setSessionStatus`, `setSessionSummary`, `clearPendingQuestion`, `setPendingQuestion`, `handleCursorMiss`, `removeSession`.
4. **`ws-connection-store.ts`** — separate Zustand store of WebSocket connection state (phase, reconnect attempt, online status). UI state (`connected | connecting | reconnecting | offline | error`) is derived from it.

### Recovery coordinator

```ts
interface RecoveryState {
  latestSequence: number          // highest seq we've applied to the store
  highestObservedSequence: number // highest seq we've *seen* (may be > latest if gap)
  bootstrapped: boolean           // has initial snapshot completed?
  pendingReplay: boolean          // is a catch-up fetch needed?
  inFlight: { kind: "snapshot"; reason } | null
}

coordinator.classifyEvent(sequence): "ignore" | "defer" | "recover" | "apply"
//   ignore   — sequence <= latestSequence (dedup)
//   defer    — not bootstrapped yet OR a snapshot is in flight (event buffered)
//   recover  — gap detected (sequence !== latestSequence + 1); snapshot triggered
//   apply    — exactly latestSequence + 1; reduce into store now
```

Snapshot lifecycle:
- `beginSnapshotRecovery(reason)` acquires `inFlight` (returns false if one is already running).
- `completeSnapshotRecovery(snapshotSequence)` advances `latestSequence` and clears `inFlight` + `pendingReplay`.
- `failSnapshotRecovery()` clears `inFlight` AND `pendingReplay` to prevent infinite retry loops.
- `invalidateBootstrap()` rolls `bootstrapped` back to false with `pendingReplay` true — used when the server says `cursor_miss`.

### Transport hook: `useSessionTranscript(sessionId)`

Single per-session orchestration hook. It:

1. Subscribes to WS events for the session, passing `getFromSequence` (returns the slice's `latestSequence` or undefined for the brand-new case) and `onCursorMiss` (calls `store.handleCursorMiss`).
2. On every WS open (initial *and* every reconnect), if the slice isn't yet bootstrapped, fires a snapshot via `runSnapshot("bootstrap")`. Reconnect-after-bootstrap uses the cursor protocol on the server, so no client-side snapshot is needed.
3. Watches `slice.recovery.pendingReplay` — if it goes true while no snapshot is in flight (a gap detected mid-stream OR a `cursor_miss` was received), runs `runSnapshot("sequence-gap")` or `runSnapshot("cursor-miss")`.

`runSnapshot` itself is a tiny module-scope async function. **Once `beginSnapshot` returns true, the caller owns the inFlight token and MUST release it** via `applySnapshot` or `failSnapshot` — there are no early returns on unmount, because under StrictMode an early-return after `beginSnapshot` would leak the token and make every subsequent event get classified `defer` forever.

Bounded `deferredEvents`: if the buffer of deferred events exceeds `MAX_DEFERRED_EVENTS` (500), the oldest is dropped and `pendingReplay` is set so the gap effect refetches a clean snapshot. Defense-in-depth for persistent-gap pathologies.

### Slice → UI

```ts
interface SessionSlice {
  session: Session                            // metadata: status, summary, …
  messageIds: number[]                        // sequence-ordered
  messageById: Record<number, SessionMessage> // normalised
  pendingPrompts: PendingPrompt[]             // optimistic user inputs
  pendingQuestion: PendingQuestion | null
  presence: PresenceUser[]
  recovery: RecoveryState
  deferredEvents: ServerEvent[]               // held while bootstrap / snapshot in flight
}
```

`useSessionController` is a thin layer over `useSessionTranscript` that derives `phase`, runs `processTranscript` for classification, filters by visibility, and exposes actions (`resumeSession`, `answerQuestion`, mutations). Its public interface is unchanged from the pre-refactor version, so consumers — `SessionView`, `SessionTranscript` — didn't move.

```ts
type SessionPhase =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "streaming" }
  | { status: "awaiting_input"; question: PendingQuestion }
  | { status: "sending" }
  | { status: "idle" }
  | { status: "errored" }
  | { status: "archived" }
```

Phase is derived from `slice.recovery.bootstrapped` + `slice.session.status` + `slice.pendingQuestion` + the resume mutation's `isPending`. There is no cyclic write-back from WS events into a shared cache (the bug class that motivated this refactor).

### Connection surface

`SessionConnectionSurface` is a tiny component mounted at the app root. It subscribes to `useWsUiState()` and shows a sonner toast whenever the connection is `reconnecting` / `offline` / `error`. Initial `connecting` is silent so users don't see a banner on every page load.

## Session lifecycle

### 1. Create (`POST /api/sessions`)

`startSession(prompt, options)` in `session-manager.ts`:

1. Calls `agentQuery({ prompt, options: { cwd, systemPrompt, ... } })` from the Agent SDK and iterates the async generator in a background IIFE.
2. The first `system:init` message yields `session_id`; the route handler waits up to 15 s for it then returns `{ sessionId }`.
3. Each yielded message is broadcast with `broadcastToSession(sessionId, { sequence, message })`. The Agent SDK writes the same message to JSONL — JSONL is the durable record; the broadcast buffer is the recent-window cache for cursor replay.
4. On `result` message (or generator completion) → `updateSessionStatus(sessionId, "complete")` + broadcast `{ type: "session_complete" }` + drop the broadcast buffer.

### 2. Resume (`POST /api/sessions/:id/resume`)

`resumeSessionQuery(sessionId, prompt, sessionToken, userProfile)`:

1. Reads JSONL line count; assigns `sequence = lineCount` and **manually broadcasts** the user prompt as `{ sequence, message: { type: "user", content: prompt, authorEmail?, authorName? } }`. The SDK's iterator wouldn't otherwise yield the user prompt back to listeners.
2. Inlines any pending attachments into the prompt sent to the SDK (`inlineAttachments`).
3. Calls `agentQuery({ prompt, options: { resume: sessionId, ... } })` with a `canUseTool` callback.
4. Iterates the iterator and broadcasts each yielded message with the running counter.

### 3. AskUserQuestion (`POST /api/sessions/:id/answer`)

The agent can pause via the built-in `AskUserQuestion` tool. Mechanism:

1. `makeCanUseTool(getSessionId)` builds a `canUseTool` callback for `agentQuery`. When the SDK calls it with `toolName === "AskUserQuestion"`:
   - `updateSessionStatus(sessionId, "awaiting_user_input")`.
   - `broadcastToSession(sessionId, { type: "ask_user_question", questions })`.
   - `await new Promise(resolve => pendingQuestions.set(sessionId, resolve))`.
2. The client store's reducer turns the `ask_user_question` event into `slice.pendingQuestion` + `slice.session.status = "awaiting_user_input"`. Phase becomes `awaiting_input`. `SessionTranscript` renders `<AskUserForm>` inline (and offers an expand-to-panel button).
3. On submit, the controller's `answerQuestion(answers)`:
   - Snapshots the prior `pendingQuestion`.
   - Calls `store.clearPendingQuestion(sessionId)` **before** the HTTP — this is the optimistic clear that makes a double-click a no-op (the form's own `submitting` state then disables the button during the in-flight request).
   - `POST /api/sessions/:id/answer { answers }`.
   - On error, calls `store.setPendingQuestion(sessionId, prior)` to restore.
4. Server: `provideAskUserAnswer(sessionId, answers)` resolves the pending promise. `canUseTool` returns `{ behavior: "allow", updatedInput: { ...input, answers } }` — the SDK injects the answers as the tool result and the agent continues.

**Fallback path:** if `provideAskUserAnswer` finds no pending resolver (server restarted while awaiting input, or the session's status drifted past `awaiting_user_input`), the route falls through to `resumeSessionQuery(sessionId, formattedAnswers)` — the answers become the user's next prompt. The client must always send the POST (and not gate on `slice.pendingQuestion`) for this fallback to fire.

```
agent calls AskUserQuestion
  → canUseTool pauses (await Promise)
  → broadcasts ask_user_question event
  → store.pendingQuestion set, phase: awaiting_input
  → SessionTranscript renders AskUserForm
user submits answers
  → controller.answerQuestion: clearPendingQuestion + POST /answer
  → provideAskUserAnswer resolves Promise (or fallback resume)
  → canUseTool returns { behavior: "allow", updatedInput: { answers } }
  → SDK continues with answers as tool result
```

### 4. Linked sessions (`GET /api/sessions/linked`)

Sessions started from email/task store the source ID in `linked_source_id` / `linked_source_type` columns. `getLinkedSession(threadId?, taskId?)` returns the most recent session linked to that item; the frontend uses it to show "Open Session" instead of "Start Session" in detail views.

## Optimistic prompts

`controller.resumeSession(prompt)` calls `store.submitOptimisticPrompt(sessionId, prompt)` synchronously — this appends a `PendingPrompt { localId, prompt, createdAt }` to the slice's `pendingPrompts` collection (separate from the real transcript) and flips `session.status` to `"running"`. The UI renders pending prompts at the tail of the transcript, with synthetic sequences derived from `Number.MAX_SAFE_INTEGER` so they never collide with real server-assigned sequences.

When the server echoes the prompt as a real user message, `reduceEvent` matches by trimmed text and clears the pending entry. `reduceSnapshot` performs the same reconciliation against any user message in the snapshot — including JSONL-shaped messages where content is nested under `message.message.content` (the SDK format) rather than `message.content` (our manual broadcast format).

## Transcript rendering (`SessionTranscript`)

Messages are rendered by `TranscriptEntry` (memoised) inside a TanStack Virtual virtualizer. Each entry is an `Accordion` block:

| SDK message type | Rendered as |
|---|---|
| `system:init` | Hidden |
| `system:result` / `result` in msg | Result accordion (open by default) |
| `user` / `role:user` (normal) | "You" accordion, text + IDE file chips |
| `user` / `role:user` (skill context) | Collapsed accordion with `Wrench` icon + skill directory name |
| `assistant` → `text` block | "Claude" text accordion (markdown) |
| `assistant` → `tool_use` block | Tool name + summary + JSON input |
| `assistant` → `thinking` block | "Thinking" accordion |
| `tool_result` | Hidden |

**Skill context blocks:** When the agent SDK runs a skill, it injects a user-role message starting with `"Base directory for this skill: ..."`. `extractSkillBlock()` detects this, extracts the skill name from the directory path's last segment, and renders it as a collapsed accordion with a `Wrench` icon.

**IDE context chips:** User messages from the Claude Code VSCode extension include `<ide_opened_file>` and `<ide_selection>` blocks. `parseIdeContext()` extracts these and renders them as compact file reference chips below the message text.

**Auto-scroll:** Fires only when the user is near the bottom (within 100px), so scrolling up to read history doesn't yank back down.

## Two-source session list

`GET /api/sessions` merges DB sessions with the JSONL files found by scanning `~/.claude/projects/`. DB sessions appear first; agent-only sessions are appended as `status: "complete"`. The list is deduplicated by `id` and sorted by `updatedAt` desc. The agent scan reads only the head/tail of each JSONL to extract `cwd` + `firstPrompt` + `summary`, keeping the cache cheap.

## Environment isolation

`buildAgentEnv()` constructs the env for each agent's `query()` call:

- **Excludes `ANTHROPIC_API_KEY`** so the agent uses the user's Claude subscription.
- **Excludes `CLAUDECODE`** so the spawned agent doesn't detect it's inside another Claude Code session.

## Reliability invariants

These are checked by the seeded chaos test (`session-store.chaos.test.ts`) — five seeds × 1000 random actions each:

- `messageIds` is sorted ascending with unique entries.
- `Object.keys(messageById).map(Number).sort()` equals `messageIds`.
- `latestSequence` never decreases.
- `inFlight` follows the begin → (complete | fail) protocol — set iff the test driver's depth counter is 1.

A Playwright multi-tab smoke test (`tests/e2e/session-multi-tab.spec.ts`) opens the same session in two contexts and asserts both render without console errors — the StrictMode / inFlight-leak class of bugs that motivated parts of this refactor.

## Key files

| File | Role |
|------|------|
| [`server/lib/session-manager.ts`](../server/lib/session-manager.ts) | DB ops, broadcast buffer, WS subscribe, agent SDK integration |
| [`server/index.ts`](../server/index.ts) | WS endpoint + handshake |
| [`server/routes/sessions.ts`](../server/routes/sessions.ts) | HTTP routes (REST snapshot, resume, answer fallback) |
| [`src/stores/session-recovery.ts`](../src/stores/session-recovery.ts) | Pure recovery coordinator state machine |
| [`src/stores/session-reducer.ts`](../src/stores/session-reducer.ts) | Pure slice reducers |
| [`src/stores/session-store.ts`](../src/stores/session-store.ts) | Zustand store + actions |
| [`src/stores/ws-connection-store.ts`](../src/stores/ws-connection-store.ts) | WS connection state machine |
| [`src/hooks/use-ws-stream.tsx`](../src/hooks/use-ws-stream.tsx) | Multiplexed WS provider — subscribe, ping, reconnect, cursor_miss |
| [`src/hooks/use-session-transcript.ts`](../src/hooks/use-session-transcript.ts) | Per-session transport — bootstrap, cursor, gap recovery |
| [`src/hooks/use-session-controller.ts`](../src/hooks/use-session-controller.ts) | Phase derivation, pipeline integration, action callbacks |
| [`src/components/session/SessionConnectionSurface.tsx`](../src/components/session/SessionConnectionSurface.tsx) | Toast-driven connection-state surface |
| [`src/components/session/SessionView.tsx`](../src/components/session/SessionView.tsx) | Session detail + chat input |
| [`src/components/session/SessionTranscript.tsx`](../src/components/session/SessionTranscript.tsx) | Virtualized transcript |
| [`src/components/session/AskUserForm.tsx`](../src/components/session/AskUserForm.tsx) | AskUserQuestion form |
