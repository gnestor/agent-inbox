# Session Views Controller

## Purpose

The HTTP-and-React surface that exposes `session-manager` to the user: REST routes under `/api/sessions/*` (CRUD, attach, abort, archive, answer, artifact patch, file upload/download), the `SessionListView` ListView wrapper, and the `SessionView` detail panel. The detail panel is split between `useSessionController` (data + streaming + actions) and `useSessionView` (UI state: title editing, navigation, file attachments). The transcript itself is rendered by `SessionTranscript`, which classifies JSONL entries into message bubbles, tool-call groups, AskUserQuestion forms, and output accordions.

## Context

### Why the controller is split into two hooks
`useSessionController` owns everything that can change asynchronously — REST queries, WebSocket events, mutations, derived `phase` discriminated union. `useSessionView` owns UI-only state — whether the title input is open, what the user is typing, file attachments staged for the next turn, navigation back-callbacks. Mixing the two would force every title-edit keystroke through the same memoisation graph that handles transcript updates, slowing the UI; splitting also means the controller is testable without rendering, and the view hook is testable without WebSocket mocks.

### Why `phase` is a discriminated union
A session can be `loading | error | streaming | awaiting_input | sending | idle | errored | archived`. Encoding each as a boolean (`isLoading`, `isStreaming`, `isAwaitingInput`) admitted impossible states (e.g. loading + awaiting_input). The discriminated union — required by the workspace-level React design patterns — closes those holes at the type level, and lets `SessionView` drive its render purely from `phase.status` without a chain of `if/else`.

### Why REST and WebSocket coexist for the transcript
The WS broadcast is the live source; REST is for first paint and for "scroll back" replay when the WS buffer rolls over. The transcript hook (used by the controller) calls REST `GET /api/sessions/:id` for the snapshot then takes WS deltas; on `cursor_miss` it re-fetches via REST. This bypass-and-resync pattern keeps the WebSocket buffer bounded (capacity 500 events) without losing fidelity for users who reconnect mid-session.

### Why `withInitialUserPrompt` synthesises a seq-0 user message
The Agent SDK's JSONL transcript does not include the initial user prompt — it's a constructor argument, not a streamed message. The WS broadcast emits a synthetic seq-0 user turn so the live UI sees the prompt; REST has to emit the same shape or first paint and live state would disagree. `withInitialUserPrompt` is the REST-side mirror of that synthesis.

### Why session-list filters live in URL/preference state, not the controller
`SessionListView` reads filters via `useNavigation().getFilters("sessions")` and persists them to the navigation store. This means a tab-switch followed by a tab-switch-back restores the filter, and a direct deep link reproduces the filtered view. Storing them in the controller's React state would lose them on tab-unmount.

### Why the file-upload route is `multipart/form-data`, not JSON+base64
Agents work with files on the filesystem; the upload path writes directly to `${workspacePath}/sessions/{id}/input/<sanitised>` with no encoding round-trip. Multipart also lets the browser stream large files without buffering the base64 representation in memory. The download route streams via `readFileSync` from the same layout via `getSessionFilePath` (input-then-output search).

### Why `POST /api/sessions/:id/abort` returns immediately
Aborting waits on the SDK's cancellation propagation, which can take seconds for an in-flight tool call. The route fires the abort signal and returns 204; the WS broadcast carries the actual end-of-stream event. Polling the abort endpoint for completion would reproduce data the WS already streams.

### Why session creation is rate-limited per user-or-IP
Creating a session spawns an agent process and burns API tokens. The route applies `rateLimit({ windowMs: 60_000, max: 10, keyFn: email ?? ip })` — generous enough for normal use, low enough to bound damage from a runaway client or a leaked cookie.

### What is NOT in scope
- Agent lifecycle, JSONL writes, broadcast buffer → `session-manager` spec.
- File path layout and validation → `session-files` spec.
- The behavioural-instruction string prepended to system prompts → `session-instructions` spec.
- WebSocket framing, presence, cursor-miss semantics → `session-streaming` spec.
- Artifact transform / iframe rendering inside the transcript → `artifacts-and-render-tools` spec.
- Generic ListView component used by `SessionListView` → `data-table-list-views` spec.

## Requirements

### REST surface

#### Scenario: `POST /api/sessions/` starts a session and returns `{ sessionId }`
- **WHEN** the route receives a `CreateSessionBody` (Zod-parsed `prompt`, optional `linkedSourceType`/`linkedSourceId`/`linkedSourceContent`/`linkedItemTitle`)
- **THEN** it calls `sessions.startSession(prompt, { ...linked, triggerSource: "manual", userSessionToken, workspacePath })` and returns `{ sessionId }` with status 200.
- **AND** it is gated by `rateLimit({ windowMs: 60_000, max: 10, label: "session-create", keyFn: email ?? ip })`.
- **AND** Zod failures return 400 with the first issue's `message`.

#### Scenario: `GET /api/sessions/` lists sessions for the active workspace
- **WHEN** the request specifies optional `?status=` and `?q=` filters
- **THEN** the route resolves the active workspace, calls into `session-manager`'s list helper, and returns the array.
- **AND** sessions outside the active workspace are not returned — list scoping is by `~/.claude/projects/{encoded-path}/`.

#### Scenario: `GET /api/sessions/:id` returns session metadata + transcript with synthetic seq-0
- **WHEN** the route serves a session detail
- **THEN** it returns the DB session row plus the JSONL transcript transformed by `withInitialUserPrompt(transcript, sessionId, prompt, createdAt)` — prepending a synthetic user turn at sequence 0 if the transcript doesn't already start with `type: "user"`.
- **WHY:** the WS broadcast emits a seq-0 user turn for the initial prompt; REST has to mirror that shape or first paint and live state diverge.

#### Scenario: `PATCH /api/sessions/:id` renames or marks-manually-titled
- **WHEN** the body contains `{ summary }` (and/or `manuallyTitled: true`)
- **THEN** the route updates the DB row and `autoNameSession` will skip future auto-naming.

#### Scenario: `POST /api/sessions/:id/answer` resolves a pending `AskUserQuestion`
- **WHEN** the body matches `AnswerSessionBody` (`{ answers: Record<string,string> }`)
- **THEN** the route looks up `pendingQuestions.get(sessionId)` in `session-manager` and resolves it with the answers.
- **AND** if no question is pending, the route returns 409.

#### Scenario: `POST /api/sessions/:id/resume` continues a session with a new user turn
- **WHEN** the body matches `ResumeSessionBody` (`prompt` plus optional inline file attachments)
- **THEN** `session-manager.resumeSession` is invoked with the same `userSessionToken`/`workspacePath` plumbing as create.

#### Scenario: `POST /api/sessions/:id/attach` adds attached_context to the next user turn
- **WHEN** the body matches `AttachToSessionBody` (`type`, `id`, `title`, `content`)
- **THEN** the manager appends a JSONL `attached_context` entry to be inlined as `<attached_context>` on the next resume.

#### Scenario: `POST /api/sessions/:id/abort` and archive/unarchive
- **WHEN** the route is hit
- **THEN** it triggers the corresponding `session-manager` action and returns 204.
- **AND** archive/unarchive update the DB row's `archivedAt` timestamp.

#### Scenario: `PATCH /api/sessions/:id/artifact` rewrites JSONL artifact code
- **WHEN** the body matches `PatchArtifactBody` (`sourceToolUseId`, `code`)
- **THEN** the route calls `session-manager.patchArtifactCode` to rewrite the JSONL in place — JSONL is the single source of truth for artifact code (see project memory note).

#### Scenario: `POST /api/sessions/:id/files` uploads a file to `input/`
- **WHEN** the route receives a `multipart/form-data` body
- **THEN** it calls `saveSessionFile(workspacePath, sessionId, filename, buffer, mimeType)` and returns the `{ name, path, size, mimeType }` metadata from `session-files`.

#### Scenario: `GET /api/sessions/:id/files/:filename` downloads a file
- **WHEN** the route receives a filename
- **THEN** it calls `getSessionFilePath` (which searches `input/` then `output/`) and streams the file via `readFileSync`.
- **AND** `path.normalize` is used to defend against `..` segments even though the helper already validates.

### Detail-panel hooks

#### Scenario: `useSessionController` exposes a `phase` discriminated union
- **WHEN** any consumer reads `controller.phase`
- **THEN** the value is one of `{ status: "loading" | "error" | "streaming" | "awaiting_input" | "sending" | "idle" | "errored" | "archived" }` — never a tuple of booleans.
- **AND** `phase.status === "awaiting_input"` carries the `question: PendingQuestion`.
- **AND** `phase.status === "error"` carries `message: string`.
- **WHY:** the workspace-level React design patterns mandate discriminated unions over boolean flags; this is the canonical example in this codebase.

#### Scenario: Controller filters classified messages by visibility
- **WHEN** a caller passes `visibility: TranscriptVisibility`
- **THEN** the controller returns `messages: ClassifiedMessage[]` already filtered by `filterVisible(processTranscript(...), visibility)` — the consumer does not re-filter.

#### Scenario: Controller exposes mutations bag
- **WHEN** the consumer calls `controller.mutations.rename.mutate(title)` / `abort.mutate()` / `archive.mutate()` / etc.
- **THEN** the underlying `useSessionMutations` hook performs the REST call, optimistic-update the React Query cache, and invalidate `["session", id]` on settle.

#### Scenario: `useSessionView` owns UI-only state
- **WHEN** the consumer reads view state (`isEditing`, `editTitle`, `displayTitle`, attachments)
- **THEN** these values come from `useSessionView`, never from the controller.
- **AND** `displayTitle` is derived in the order `linkedItemTitle → summary → title prop → prompt[:80] → "Untitled"`.

#### Scenario: `useSessionView` opens output panels via the navigation store
- **WHEN** the user clicks an output accordion in the transcript
- **THEN** `useSessionView.handleOpenPanel(spec, sequence)` calls `pushPanel({ id: "output:${sessionId}:${sequence}", type: "output", props: { sessionId, sequence, outputType, spec } })`.

#### Scenario: `useSessionView` removes its own panel on archive/back
- **WHEN** the user archives the session or hits back from a non-sidebar route
- **THEN** the hook calls `removePanel(panelId)` from `useNavActions`.

### List view

#### Scenario: `SessionListView` renders via the shared ListView with a fixed schema
- **WHEN** the component mounts
- **THEN** it composes a `ListView` with `sessionFieldSchema` declaring `summary` (title), `updatedAt` (timestamp), `status` (badge with `sessionStatusBadgeClass`/`sessionStatusLabel`), plus hidden `linkedEmailId`/`linkedTaskId`/`prompt` fields used by search.
- **AND** filterable status options are exactly `["running","complete","awaiting_user_input","errored","archived"]`.

#### Scenario: List filters persist via the navigation store, not local state
- **WHEN** a user toggles a status filter
- **THEN** `setFilter("sessions", key, value)` is called via `useNavigation`, persisting through tab-switches and deep-links.
- **AND** `cleanFilters` strips empties before the request goes out.

#### Scenario: Backend errors fall back to cached data, not an inline banner
- **WHEN** `useSessions()` returns an error
- **THEN** the list still renders `data ?? []` and the only error feedback is the global `SessionConnectionSurface` toast — no duplicate inline red banner.
- **WHY:** users keep their scroll position and can still navigate to recently-viewed sessions while the backend recovers.

### Detail panel

#### Scenario: `SessionView` is a thin presenter over the two hooks
- **WHEN** the panel renders
- **THEN** the component does no fetching of its own — it composes `useSessionController` (data) and `useSessionView` (UI), then forwards their outputs to `SessionTranscript`, `SessionInput`, and `PanelHeader`.
- **AND** all conditionals are driven from `controller.phase.status`.

#### Scenario: First-load skeleton overlays until artifacts settle
- **WHEN** a session is loading its first paint
- **THEN** the panel shows `PanelSkeleton` until `dataReady && readySessions.has(sessionId)` — the `readySessions` Set is bounded at 100 with FIFO eviction to prevent unbounded growth across long SPA usage.
- **AND** `handleArtifactsReady` is called from `SessionTranscript` once all `ArtifactFrame`s have reported live heights.

## Technical Notes

| Concern | Location |
|---|---|
| REST routes (`/api/sessions/*`) including upload/download | [server/routes/sessions.ts](../../../server/routes/sessions.ts) |
| `withInitialUserPrompt` synthetic seq-0 prepender | [server/routes/sessions.ts](../../../server/routes/sessions.ts#L30-L48) |
| Detail-panel data/streaming/actions controller | [src/hooks/use-session-controller.ts](../../../src/hooks/use-session-controller.ts) |
| Detail-panel UI state (title edit, panel nav, attachments) | [src/hooks/use-session-view.ts](../../../src/hooks/use-session-view.ts) |
| Detail panel composition | [src/components/session/SessionView.tsx](../../../src/components/session/SessionView.tsx) |
| List view + field schema + status filter set | [src/components/session/SessionListView.tsx](../../../src/components/session/SessionListView.tsx) |
| Transcript renderer (classifies JSONL → bubbles, tool groups, output accordions, AskUserQuestion forms) | [src/components/session/SessionTranscript.tsx](../../../src/components/session/SessionTranscript.tsx) |
| Route + REST tests | [server/routes/__tests__/sessions.test.ts](../../../server/routes/__tests__/sessions.test.ts) |
| Controller hook tests | [src/hooks/__tests__/use-session-view.test.tsx](../../../src/hooks/__tests__/use-session-view.test.tsx) |
| `<SessionInput>` composer textarea + send/stop button | [src/components/session/SessionInput.tsx](../../../src/components/session/SessionInput.tsx) |
| `<AskUserForm>` inline AskUserQuestion form rendered in transcript | [src/components/session/AskUserForm.tsx](../../../src/components/session/AskUserForm.tsx) |
| `<SessionConnectionSurface>` toast surfacing of WS connection state | [src/components/session/SessionConnectionSurface.tsx](../../../src/components/session/SessionConnectionSurface.tsx) |
| AskUserForm controller hook (selections, other-text, submit) | [src/hooks/use-ask-user-form.ts](../../../src/hooks/use-ask-user-form.ts) |
| Transcript autoscroll / pin-to-bottom hook | [src/hooks/use-transcript-scroll.ts](../../../src/hooks/use-transcript-scroll.ts) |
| Composer draft persistence (IndexedDB-backed) | [src/hooks/use-local-draft.ts](../../../src/hooks/use-local-draft.ts) |
| Pure transcript-processing helpers (no React) | [src/lib/session-pipeline.ts](../../../src/lib/session-pipeline.ts) |
| Pure session-slice reducer | [src/stores/session-reducer.ts](../../../src/stores/session-reducer.ts) |

## History

- The phase model was originally three booleans (`isLoading`, `isStreaming`, `isAwaitingInput`); flipped to a discriminated union after a regression where a session could enter `awaiting_input` while `isLoading` was still `true`, causing the AskUserQuestion form to render under a skeleton.
- `withInitialUserPrompt` was added when REST first-paint started showing transcripts that began with the assistant's response — the Agent SDK's JSONL omits the initial prompt, so the WS broadcast had been the only place that user turn existed.
- The `readySessions` Set acquired its 100-cap after a memory profile of a long-lived SPA tab showed it growing unboundedly during a multi-hour debugging session.
- The list view stopped showing an inline red error banner after UX feedback that the global toast plus a stale-but-usable list was strictly better than a wiped list with a banner.
- `PATCH /api/sessions/:id/artifact` replaced an earlier "edit artifact in IndexedDB" client-only path after the project_inbox_artifact_source_of_truth doctrine landed: JSONL is the only authoritative source, so artifact edits must rewrite JSONL.
