# Session Architecture

Sessions are Claude Code agent runs managed by the inbox server. They can be started from an email thread or task, tracked in real-time via SSE, resumed with follow-up prompts, and browsed after completion.

## Data model

```
sessions                          session_messages
───────────────────────────────   ──────────────────────────────
id          TEXT PK               session_id  TEXT FK
status      TEXT                  sequence    INTEGER
prompt      TEXT                  type        TEXT
summary     TEXT                  message     TEXT (JSON)
message_count INTEGER             created_at  TEXT
linked_email_id TEXT
linked_task_id  TEXT
started_at  TEXT
updated_at  TEXT
```

`session_messages` stores every SDK message in order (by `sequence`). The `message` column is a JSON-serialized SDK message object. `sessions.message_count` is kept in sync on every insert as a cheap O(1) count.

## Session lifecycle

### 1. Create (`POST /api/sessions`)

`startSession(prompt, options)` in `session-manager.ts`:

1. Calls `query({ prompt, options: { cwd, systemPrompt, ... } })` from the Agent SDK
2. Iterates the async generator in a background task
3. On the first `system:init` message, extracts `session_id` and calls `createSessionRecord()` to insert the DB row
4. Every subsequent SDK message is persisted with `appendSessionMessage()` and live-broadcast with `broadcastToSession()`
5. On `result` message or generator completion → `updateSessionStatus("complete")`
6. The HTTP handler blocks until `session_id` is captured (max 15s) then returns `{ sessionId }`

```
POST /api/sessions
    → startSession()
        → query() [Agent SDK]
        → background: for await (msg) → appendSessionMessage + broadcastToSession
    ← { sessionId }
```

### 2. SSE stream (`GET /api/sessions/:id/stream`)

Clients connect immediately and stay connected for live updates:

1. Server calls `addSseClient(sessionId, send)`
2. Sends **all existing messages** from the DB as catch-up events (so a client that connects after session start sees the full history)
3. Sends a keepalive `ping` event every 15s
4. `broadcastToSession()` pushes new messages to all connected clients in real-time
5. On client disconnect, removes the SSE client and clears the keepalive interval

**Wire format:**
```json
{ "sequence": 3, "message": { "type": "assistant", "content": [...] } }
```

Control events use `type` directly (no `sequence`):
```json
{ "type": "session_complete", "status": "complete" }
{ "type": "session_error", "error": "..." }
```

### 3. Client: `useSessionStream`

```ts
const stream = useSessionStream(sessionId)
// stream.messages   — all received SessionMessage[]
// stream.connected  — EventSource open
// stream.sessionStatus — "complete" | "errored" | null
```

Key detail: `seenSequences` ref guards against duplicate delivery. The SSE endpoint replays all existing messages on every connect (for catch-up), so if the client reconnects mid-session it would see messages twice without this guard. The ref is cleared on `sessionId` change.

### 4. Resume (`POST /api/sessions/:id/resume`)

`resumeSessionQuery(sessionId, prompt)` in `session-manager.ts`:

1. Persists the **user's own prompt** as a message immediately (sequence = existing count):
   ```ts
   const userMessage = { type: "user", content: prompt }
   appendSessionMessage(sessionId, sequence, "user", userMessage)
   broadcastToSession(sessionId, { sequence, message: userMessage })
   ```
   Without this step the user's message never appears in the transcript because the Agent SDK only emits assistant and tool messages in its output.
2. Calls `query({ prompt, options: { resume: sessionId, ... } })` — Agent SDK resumes the session from its saved state
3. Continues appending/broadcasting SDK messages like `startSession`

### 5. Transcript rendering (`SessionTranscript`)

Messages are rendered by `TranscriptEntry` (memo-wrapped) inside a TanStack Virtual virtualizer. Each entry is an `Accordion` block:

| SDK message type | Rendered as |
|---|---|
| `system:init` | Hidden |
| `system:result` / `result` in msg | Result accordion (open by default) |
| `user` / `role:user` | "You" accordion, text + IDE file chips |
| `assistant` → `text` block | "Claude" text accordion (markdown) |
| `assistant` → `tool_use` block | Tool name + summary + JSON input |
| `assistant` → `thinking` block | "Thinking" accordion |
| `tool_result` | Hidden |

**IDE context chips:** User messages from Claude Code VSCode extension include `<ide_opened_file>` and `<ide_selection>` blocks. `parseIdeContext()` extracts these and renders them as compact file reference chips below the message text:

```
You
  Fix the bug in this function
  [filename.ts:42-51]  ← chip for ide_selection
```

**Auto-scroll:** `shouldAutoScroll` ref tracks whether the user is near the bottom (within 100px). Auto-scroll only fires when near the bottom, so users can scroll up to read history without being yanked back down.

## Two-source session list

`GET /api/sessions` merges two data sources:

1. **Local DB sessions** — sessions started through the inbox UI (have linked email/task metadata, real-time status)
2. **Agent SDK sessions** — all Claude Code sessions found by scanning `~/.claude/projects/` JSONL files (discovered via `listAllAgentSessions`)

DB sessions take priority (appear first); agent sessions not already in the DB are appended as status=`"complete"`. The list is deduplicated by `id` and sorted by `updatedAt` desc.

The agent session scan reads only the first 20 and last 10 lines of each JSONL file (not the whole file) for `cwd` + `firstPrompt` + `summary`. This keeps the 1-minute cache warm without touching 1.3GB+ of session history.

## Environment isolation

`buildAgentEnv()` constructs the env for agent subprocesses:

- **Excludes `ANTHROPIC_API_KEY`** so the agent uses the user's Claude subscription (not an API key)
- **Excludes `CLAUDECODE`** so the spawned agent doesn't detect it's inside another Claude Code session (which would change behavior — e.g. skipping tool confirmations or switching permission modes)

## Key files

| File | Role |
|------|------|
| [`server/lib/session-manager.ts`](../server/lib/session-manager.ts) | All session DB ops, SSE broadcast, agent SDK integration |
| [`server/routes/sessions.ts`](../server/routes/sessions.ts) | HTTP routes, SSE endpoint, session list merge |
| [`src/hooks/use-session-stream.ts`](../src/hooks/use-session-stream.ts) | SSE client hook with deduplication |
| [`src/components/session/SessionView.tsx`](../src/components/session/SessionView.tsx) | Session detail + chat input |
| [`src/components/session/SessionTranscript.tsx`](../src/components/session/SessionTranscript.tsx) | Virtualized message list, accordion blocks, IDE context chips |
| [`src/components/session/SessionList.tsx`](../src/components/session/SessionList.tsx) | Session list with status/project filters |
