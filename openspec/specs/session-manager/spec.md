# Session Manager

## Purpose

The lifecycle owner for every Claude Agent SDK session: spawning (`startSession`), resuming (`resumeSessionQuery`), aborting, attaching context mid-session, indexing JSONL files, classifying transcript blocks, and patching artifact code. Builds the agent's environment (excluding sensitive vars, optionally routing through the [credential proxy](../credential-proxy/spec.md)), discovers plugin paths, registers MCP servers (`render_output`, `artifact`, `AskUserQuestion`), and persists session rows in the `sessions` table. Also owns the multiplexed WebSocket client registry, presence tracking, and the sequenced broadcast buffer that lets reconnecting clients catch up via cursor-based replay.

## Context

### Why a single module owns all session lifecycle
Every session phase (start, resume, abort, recover, archive) reads or writes the same ambient state — `runningQueries: Map<id, AbortController>`, `pendingQuestions`, the JSONL on disk, the `sessions` DB row, the broadcast buffer, the WS client set. Splitting the lifecycle into separate modules would either duplicate that state or force a circular import graph. The 2 k-line file is intentional: it's *one* state machine, surfaced behind ~30 small exports.

### Why env vars are filtered, not opted-in
The agent inherits `process.env` so it can find Node binaries, NPM caches, locale, etc. We can't enumerate every safe var the agent needs across plugins. Instead we maintain a `excluded` set of every known sensitive name and let the rest through. When a new credential type appears, *one* line is added to the exclude list; a missed inclusion would silently bypass the credential proxy and re-leak the secret to the agent.

### Why credential proxy is opt-in per call
`startSession` and `resumeSessionQuery` accept a `userSessionToken`. When set, the agent env adds `HTTPS_PROXY`/`NODE_EXTRA_CA_CERTS`/`NODE_OPTIONS` from `credentialProxy.getProxyEnv(token)` so all third-party API calls flow through the MITM proxy. When unset (background curation, dev-time), the legacy `getAgentEnv(workspaceId)` re-injects raw tokens directly. Callers that have a logged-in user pass the token; everything else falls back.

### Why JSONL is the authoritative transcript, not the DB
The Agent SDK writes every message to `~/.claude/projects/<encodedCwd>/<sessionId>.jsonl` regardless of what we do. We index those files for the session list, but never copy the messages into Postgres — duplicating would either drift or require a write-through layer that becomes the new bottleneck. Memory note `project_inbox_artifact_source_of_truth.md` formalises this: *JSONL is the only authoritative source for artifact code*.

### Why `BROADCAST_BUFFER_CAPACITY = 500` per session
The buffer exists so a WebSocket client that disconnects mid-stream can reconnect with `fromSequence` and replay missed events without us reloading the entire transcript. 500 is roughly the tail of a busy hour-long session. Anything older falls out of the window — we send `cursor_miss` and the client falls back to a REST snapshot. Bigger would balloon memory (~hundreds of KB per session); smaller would force snapshots after brief tab switches.

### Why presence broadcasts are debounced (200 ms) and reaped (60 s stale)
A single user opening 5 tabs would otherwise emit 5 immediate `presence` events. Debouncing by 200 ms coalesces them into one. Reaping every 30 s drops users whose `lastSeen` is older than 60 s — covers tabs that closed without a clean unsubscribe (browser killed, network dropped).

### Why `pendingQuestions` is a Map with a callback, not state on the session
When the agent calls `AskUserQuestion`, the `canUseTool` hook returns a Promise that the agent awaits. We store the resolver in `pendingQuestions[sessionId]`; when the user answers via REST, `provideAskUserAnswer` calls the resolver and the agent unblocks. Persisting the Promise in the DB or in-memory state would require serialising a function — we just keep it next to the active `AbortController`.

### Why `attached_context` system entries get inlined into the next prompt
The user can attach an email/Notion task to an already-running session. We append a `{ type: "system", subtype: "attached_context", ... }` line to the JSONL immediately, but the Agent SDK's resume flow only forwards user/assistant messages — so the agent would never see the attachment. `collectPendingAttachments` walks the JSONL backwards from the end, gathers attachments since the last user/assistant turn, and `inlineAttachments` prepends them to the next user prompt as `<attached_context>` XML blocks.

### Why [workspace](../workspace/spec.md) path → projects-dir uses simple `/` → `-` replacement
The Agent SDK encodes a workspace's CWD into the directory name under `~/.claude/projects/`. Replicating its convention (`encodeWorkspacePath`) means we can find the JSONL files it writes without parsing or callbacks. The encoding is lossy on paths containing literal `-`, but real workspace paths don't, and accepting the collision is cheaper than running a path → dir lookup table.

### Why `lastTouchTime` debounces `updated_at` writes (5 s)
A streaming session emits dozens of events per second. Writing `UPDATE sessions SET updated_at = ... WHERE id = ...` per event would saturate the connection pool. Debouncing to 5 s means the row's mtime is fresh enough for sorting "recent sessions" without hammering the DB.

### What is NOT in scope
- The MCP tool definitions (`render_output`, `artifact`, `AskUserQuestion`) → `artifacts-and-render-tools` and the spec's own owners.
- The WebSocket transport itself (Hono route, upgrade handling, cookie auth) → `session-streaming` spec.
- The `sessions` table schema → `database` spec.
- Session-list UI / filtering → `session-views-controller` spec.
- Auto-naming via Haiku → `title-generator` spec.
- Credential injection details — what header/format per host → `credential-proxy` spec.

## Requirements

### Workspace-path / JSONL plumbing

#### Scenario: `encodeWorkspacePath` mirrors the Agent SDK's projects-dir convention
- **WHEN** any helper resolves a session's JSONL location
- **THEN** it computes `homedir() + "/.claude/projects/" + path.replace(/\//g, "-") + "/<sessionId>.jsonl"`.
- **AND** `workspaceProjectsDir(cwd?)` returns the directory portion (without the filename) so directory listings can scan all sessions for a workspace.

#### Scenario: `setWorkspacePath` persists the default and derives a workspace name
- **WHEN** the server boots or the user switches workspaces
- **THEN** `defaultWorkspacePath` is set to `resolve(path)` and `defaultWorkspaceName` is derived asynchronously via `workspace-scanner.deriveWorkspaceName` (with a fallback to `path.split("/").pop()` if scanner import fails).

### Session creation and DB row

#### Scenario: `createSessionRecord` inserts a row in `sessions` with status `running`
- **WHEN** a session is started with a known `sessionId`
- **THEN** the row is inserted with `status='running'`, `prompt`, `summary` derived from `linkedItemTitle` or `prompt.slice(0, 80)`, `started_at`/`updated_at` set to now, plus `linked_source_type`, `linked_source_id`, `trigger_source` (default `manual`), and `metadata` JSON (carrying `linkedItemTitle` if any).

#### Scenario: `updateSessionStatus` debounces touches at 5 s per session
- **WHEN** `touchSession` is called within `TOUCH_DEBOUNCE_MS = 5_000` of the previous touch for the same id
- **THEN** the second `UPDATE sessions SET updated_at = ...` is skipped, avoiding write amplification during streaming.

#### Scenario: `archiveSession` / `unarchiveSession` flip status to/from `archived`
- **WHEN** the user archives a session
- **THEN** the row's `status` becomes `archived`; `unarchive` flips it back to `complete`.
- **AND** both helpers return `false` if no row exists.

### Agent process spawning

#### Scenario: `startSession` calls the SDK with a fixed tool allowlist and bypassed permissions
- **WHEN** `startSession(prompt, options)` runs
- **THEN** the SDK's `query()` is called with `cwd: workspacePath`, `allowedTools: ["Read", "Grep", "Glob", "Bash", "Write", "Edit", "Skill"]`, `permissionMode: "bypassPermissions"`, `allowDangerouslySkipPermissions: true`, `includePartialMessages: true`, plus an `AbortController` registered in `runningQueries`.
- **AND** `mcpServers` registers `render_output` and `artifact` in-process MCP servers; `plugins` enumerates `INBOX_PLUGINS_DIR` plus every immediate subdirectory of `<wsPath>/plugins/`.
- **AND** `betas: ["context-1m-2025-08-07"]` is enabled so the agent can use 1 M context where supported.

#### Scenario: System prompt is `claude_code` preset + `SESSION_INSTRUCTIONS` + optional source context
- **WHEN** `buildSystemPrompt(sourceContext)` runs
- **THEN** the result is `{ type: "preset", preset: "claude_code", append: [SESSION_INSTRUCTIONS, sourceContext].filter(Boolean).join("\n\n") }`.

#### Scenario: `buildAgentEnv` excludes sensitive vars, optionally injects proxy env
- **WHEN** the agent env is built
- **THEN** every var in the `excluded` set is removed (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `VAULT_SECRET`, every per-integration `*_API_KEY`/`*_TOKEN`/OAuth-secret).
- **AND** if a `credentialProxy` is registered (`setCredentialProxy`) and a `userSessionToken` was passed, `getProxyEnv(token)` env is merged in.
- **AND** otherwise `getAgentEnv(workspaceId)` re-injects raw workspace credentials (legacy fallback).

#### Scenario: `model` option overrides the SDK default
- **WHEN** `startSession` is called with `model: "haiku"` (or a full model id)
- **THEN** `model` is passed to the SDK's `query()` options; otherwise the SDK's default (Sonnet) is used.

#### Scenario: `skipDbRecord` + `onEnd` for background jobs
- **WHEN** a background curator calls `startSession({ skipDbRecord: true, onEnd })`
- **THEN** no `sessions` row is inserted and no status updates happen against the DB.
- **AND** when the message loop terminates, `onEnd(sessionId, "complete" | "errored", error?)` fires exactly once.

### Resume / abort / attach

#### Scenario: `resumeSessionQuery(sessionId, prompt)` continues an existing session
- **WHEN** the user types a follow-up
- **THEN** the SDK is invoked with `resume: sessionId`, the same env/MCP/plugin setup as `startSession`, and the prompt is augmented by `inlineAttachments` if any pending `attached_context` entries are present in the JSONL.

#### Scenario: A prompt submitted while the iterator is already running is queued
- **WHEN** `resumeSessionQuery` is called and `runningQueries.has(sessionId)` is true and the DB status is still active
- **THEN** the prompt is pushed onto `queuedPrompts[sessionId]` (FIFO) and the function returns `{ started: false, queued: true }`.
- **AND** when the current iterator's cleanup runs (success, error, or `abortRunningSession`), `drainQueuedPrompt` pops the next entry and re-enters `resumeSessionQuery` on a microtask.
- **AND** archive discards the queue rather than draining — archived sessions don't auto-resume.

#### Scenario: `abortRunningSession` triggers the registered `AbortController`
- **WHEN** the user clicks Stop
- **THEN** `runningQueries.get(sessionId)?.abort()` runs and `isSessionRunning(sessionId)` returns false on the next call.
- **AND** any queued prompts are flushed (drained immediately) — the stop button doubles as "send my queued message now", matching Claude Desktop's UX.

#### Scenario: `attachSourceToSession` appends `attached_context` to the JSONL
- **WHEN** the user attaches an email to a running session
- **THEN** a `{ type: "system", subtype: "attached_context", sourceType, sourceId, title, content }` line is appended to the session's JSONL.

#### Scenario: `collectPendingAttachments` walks JSONL backward to the last conversational turn
- **WHEN** the resume flow needs to know what's been attached since the last user/assistant message
- **THEN** the helper iterates lines from the end, breaks on the first `type: "user" | "assistant"`, and unshifts every `attached_context` system entry encountered.

#### Scenario: `inlineAttachments` prepends `<attached_context>` XML blocks to the prompt
- **WHEN** there are pending attachments
- **THEN** each becomes `<attached_context sourceType="..." sourceId="..." title="...">${content}</attached_context>` joined by blank lines, prepended to the user's prompt.

### `AskUserQuestion` integration

#### Scenario: `canUseTool` for `AskUserQuestion` resolves when the user replies
- **WHEN** the agent calls `AskUserQuestion`
- **THEN** `makeCanUseTool(getSessionId)` returns a Promise stored in `pendingQuestions[sessionId]`; the agent awaits it.
- **AND** `provideAskUserAnswer(sessionId, answers)` invokes the resolver, removes the entry, and returns true; if no entry exists it returns false.

#### Scenario: Status flips to `awaiting_user_input` while a question is pending
- **WHEN** the agent issues `AskUserQuestion`
- **THEN** the session's DB status is updated to `awaiting_user_input` and the status flips back to `running` once the user answers.

### Multiplexed WebSocket clients

#### Scenario: `addWsClient` / `removeWsClient` track per-tab subscriptions
- **WHEN** a browser opens a session-stream WebSocket
- **THEN** `addWsClient(id, send, user?)` registers the connection with an empty `sessions` set.
- **AND** `removeWsClient(id)` removes presence for every session the client was subscribed to before deleting the entry.

#### Scenario: `wsSubscribe` replays buffered events when given `fromSequence`
- **WHEN** a client (re)subscribes with `{ id, fromSequence }`
- **THEN** `readBroadcastBufferSince(id, fromSequence)` is consulted; covered events are replayed as `session_event` messages and a `null` result triggers a `cursor_miss` so the client fetches a REST snapshot.
- **AND** terminal-state replay (`session_complete` / `session_error` / `ask_user_question`) runs after the buffer replay so message events apply before the final status flip.
- **AND** current presence is sent as a `presence` event if any users are watching.

### Sequenced broadcast buffer

#### Scenario: Buffer holds the last 500 sequenced events per session
- **WHEN** `broadcastToSession(id, data)` is called with `data` matching `{ sequence: number; message: unknown }`
- **THEN** the entry is appended to `broadcastBuffers[id]`; entries older than `BROADCAST_BUFFER_CAPACITY = 500` are shifted off the front (FIFO).
- **AND** non-sequenced data (presence, status flips) is broadcast but not buffered.

#### Scenario: `readBroadcastBufferSince(id, fromSequence)` returns coverage or null
- **WHEN** the buffer's oldest sequence > `fromSequence + 1`
- **THEN** the helper returns `null` (caller must snapshot).
- **AND** when `fromSequence ≤ 0` and the buffer is empty, returns `[]` (no events to replay).
- **AND** otherwise returns the events with `sequence > fromSequence`.

#### Scenario: `clearBroadcastBuffer(id)` drops the buffer when the session terminates
- **WHEN** a session reaches `complete` or `errored`
- **THEN** the per-session buffer is cleared so completed sessions don't hold memory.

### Presence

#### Scenario: Presence broadcasts debounce at 200 ms
- **WHEN** `addPresenceUser` or `removePresenceUser` is called
- **THEN** `schedulePresenceBroadcast(sessionId)` schedules a `presence` event after `PRESENCE_BROADCAST_DEBOUNCE_MS = 200` ms; subsequent calls within the window reset the timer instead of firing.

#### Scenario: Stale presence is reaped every 30 s with a 60 s cutoff
- **WHEN** the reaper runs
- **THEN** any `PresenceEntry` whose `lastSeen` is older than `PRESENCE_STALE_MS = 60_000` is removed and a fresh broadcast is scheduled if the user list changed.
- **AND** the reaper interval is `PRESENCE_REAP_INTERVAL_MS = 30_000`.

### JSONL indexing and search

#### Scenario: `indexAllAgentSessions` rebuilds the `sessions` table from JSONL on startup
- **WHEN** the server boots and the projects directory exists
- **THEN** every JSONL file is scanned for its init message, status is derived from the last result message, and missing rows are inserted (`importAgentSession`) so the session list survives DB resets.

#### Scenario: `recoverStaleSessions` fixes orphan `running` rows on boot
- **WHEN** the server starts and rows with `status='running'` exist whose `updated_at` is older than `cutoffMinutes` (default 30)
- **THEN** they are flipped to `errored` so the UI doesn't show ghost spinners for sessions whose process died with the previous server.

#### Scenario: `watchProjectsDir` updates the index live
- **WHEN** new JSONL files appear or existing ones grow
- **THEN** the watcher imports them (or re-derives status) so the session list reflects external `claude` CLI runs against the same workspace.

#### Scenario: `searchAgentSessions(q, wsPath?)` reads head/tail of each JSONL
- **WHEN** the user searches sessions
- **THEN** for each JSONL `readHeadTailLines(file, head=5, tail=20)` reads only the bookends; `extractSessionMeta` derives prompt/title/status/source without loading the full transcript.

#### Scenario: `findAgentSession(id)` searches every registered workspace path
- **WHEN** a session id is looked up
- **THEN** `registeredPaths` (added via `registerWorkspacePath`) are searched in order until a JSONL is found; the result includes `cwd` so subsequent helpers know which projects-dir to read.

### Transcript classification and artifact patching

#### Scenario: `getAgentSessionTranscript` returns parsed JSONL messages
- **WHEN** the transcript view loads
- **THEN** the helper reads every line, JSON-parses it, and returns the array — assistant `message.content` blocks remain in their SDK shape.
- **AND** subagent JSONL files (from the `subagents/` sibling directory) are merged in after the Agent tool_use block that spawned them, using fractional sequences `parentLineIdx + (si+1)/(n+1)` so all subagent sequences remain in `(parentLineIdx, parentLineIdx+1)` — never reaching `lineCount`. This keeps the WS broadcast counter (which starts at `lineCount` on resume) safely above every snapshot sequence, preventing the duplicate-drop that would otherwise unreconcile pending optimistic prompts.

#### Scenario: `classifyAssistantBlocks(content)` separates text/tool_use/thinking
- **WHEN** the renderer needs to know which UI affordance to use per block
- **THEN** the helper returns `{ texts, toolUses, thinking, ... }` derived from each block's `type`.

#### Scenario: `patchArtifactCode(sessionId, toolUseId, code)` rewrites a single tool_use block
- **WHEN** the user edits an artifact
- **THEN** `patchArtifactInFile` finds the JSONL line whose assistant message contains the matching `tool_use.id`, calls `patchToolUseBlock` to replace the `input.file_text` (or equivalent), and rewrites the file in place.
- **AND** the function returns `true` iff a matching block was found and rewritten.
- **WHY:** JSONL is the source of truth for artifact code (per memory note `project_inbox_artifact_source_of_truth.md`); patching anywhere else would silently desync.

### Auto-naming hand-off

#### Scenario: `autoNameSession` runs on session completion if summary still equals the prompt prefix
- **WHEN** a session completes
- **THEN** if `session.summary === session.prompt.slice(0, 80)` (i.e. user hasn't manually renamed), `generateSessionTitle(transcript)` is called and the result becomes the new summary.
- **AND** sessions with fewer than 2 transcript entries are skipped (trivial / immediate errors).

## Technical Notes

| Concern | Location |
|---|---|
| Lifecycle: `startSession`, `resumeSessionQuery`, `abortRunningSession`, `attachSourceToSession`, `archiveSession`, `recoverStaleSessions`, `indexAllAgentSessions`, `watchProjectsDir` | [server/lib/session-manager.ts](../../../server/lib/session-manager.ts) |
| Env builder excluding sensitive vars and integrating credential proxy | [server/lib/session-manager.ts](../../../server/lib/session-manager.ts#L105-L148) |
| WebSocket client registry, sequenced broadcast buffer, cursor replay | [server/lib/session-manager.ts](../../../server/lib/session-manager.ts#L592-L732) |
| Presence tracking with debounce + reaper | [server/lib/session-manager.ts](../../../server/lib/session-manager.ts#L497-L591) |
| JSONL transcript reader, head/tail meta extraction, search | [server/lib/session-manager.ts](../../../server/lib/session-manager.ts#L1432-L1740) |
| Artifact code patching (JSONL is source of truth) | [server/lib/session-manager.ts](../../../server/lib/session-manager.ts#L1987-L2063) |
| `AskUserQuestion` resolver registry | [server/lib/session-manager.ts](../../../server/lib/session-manager.ts#L53-L73) |
| System-prompt assembly composing `SESSION_INSTRUCTIONS` + source context | [server/lib/session-manager.ts](../../../server/lib/session-manager.ts#L825-L828) |
| `<SessionTab>` top-level Sessions tab composition | [src/components/session/SessionTab.tsx](../../../src/components/session/SessionTab.tsx) |
| `<NewSessionPanel>` compose-and-start panel | [src/components/session/NewSessionPanel.tsx](../../../src/components/session/NewSessionPanel.tsx) |
| `<SidebarRecentSessions>` recent-session sidebar group | [src/components/session/SidebarRecentSessions.tsx](../../../src/components/session/SidebarRecentSessions.tsx) |
| `<AttachToSessionMenu>` dropdown to attach an item to a running session | [src/components/session/AttachToSessionMenu.tsx](../../../src/components/session/AttachToSessionMenu.tsx) |
| `useSessions` list query + filters | [src/hooks/use-sessions.ts](../../../src/hooks/use-sessions.ts) |
| `useAttachToSession` mutation | [src/hooks/use-session-mutation.ts](../../../src/hooks/use-session-mutation.ts) |
| Session lifecycle mutations (resume, abort, archive, rename) | [src/hooks/use-session-mutations.ts](../../../src/hooks/use-session-mutations.ts) |

## History

- The original implementation re-read JSONL on every WebSocket reconnect; the cursor-based broadcast buffer landed after long sessions made each reconnect take seconds (full-file re-parse).
- Presence was originally instant-broadcast; debouncing + reaping shipped after a single user with 6 tabs caused a 6× event-amplification storm on every transcript event.
- `excluded` env list grew incrementally — every credential-leak audit added another 1-3 vars.
- `recoverStaleSessions` was added after a server crash mid-stream left rows stuck in `running` indefinitely; the UI showed permanent spinners until the session was manually fixed.
- `attached_context` inlining replaced an attempt to use the SDK's `system` injection (the SDK only honours `system` at session start, not on resume) — appending to JSONL + inlining on next prompt was the only path.
- `patchArtifactCode` originally lived in the artifact route and rewrote a `react_query`-cached copy of the code; the source-of-truth audit migrated it to JSONL after multiple "edited code reverts on reload" reports.
- `BROADCAST_BUFFER_CAPACITY` was 100 originally; raised to 500 after long debugging sessions hit `cursor_miss` from a tab-switch + lock-screen sequence.
- Subagent message sequences were originally assigned by re-numbering the entire merged array (`sequence = i`); this caused WS broadcast events (starting at `lineCount`) to collide with snapshot sequences above `lineCount - 1`, silently dropping the synthetic user message on resume and leaving the optimistic prompt permanently unreconciled (appearing at the end of the transcript). Fixed by using fractional sequences in `(parentLineIdx, parentLineIdx+1)` — mirroring the thinking-block pattern.
