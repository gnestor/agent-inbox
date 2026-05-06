# Title Generator

## Purpose

Auto-generate a short human-readable title for a session once enough transcript exists, replacing the first-prompt placeholder summary. The session-manager calls this from a fire-and-forget hook on assistant turn completion; failures must not affect the session itself.

## Context

### Why Haiku, not the session's own model
Title generation is a cheap classification task with no need for the session's tools or context. A small model (Claude Haiku) keeps cost negligible and latency under a second. The call uses a fresh `Anthropic` client constructed from `ANTHROPIC_API_KEY` — independent of whatever credentials the agent session itself uses.

### Why summary equals first 200 chars of prompt initially
The session is created with `summary = prompt.slice(0, INITIAL_SUMMARY_LENGTH)`. The auto-namer ONLY runs when `session.summary` still equals that placeholder — if the user has manually renamed the session or the title has already been generated, we don't overwrite it.

### Why a transcript-shaped prompt rather than raw JSONL
The function takes `Array<{ type, message }>` (matching the JSONL row shape) and parses out text content from each message. Tool-only turns are skipped because they yield nothing useful for naming. The window is "first 3 user messages plus last assistant message," chosen empirically to capture the request and the conclusion without blowing context.

## Requirements

### Build a title prompt from transcript rows

#### Scenario: Skips messages without text content
- **WHEN** `buildTitlePrompt` receives a row whose `message` JSON has no string `content` and no `text` blocks
- **THEN** that row is dropped before the window is selected.
- **WHY:** tool-call/tool-result turns add noise without naming signal.

#### Scenario: Window is first 3 user + last assistant
- **WHEN** more than 3 user messages exist
- **THEN** only the first 3 are included.
- **AND** only the most recent assistant message is appended.
- **AND** each included message's text is truncated to 500 chars.

#### Scenario: Empty transcript yields empty string
- **WHEN** no message survives parsing
- **THEN** the function returns `""` and `generateSessionTitle` returns `null` without calling the API.

### Parse Haiku's response into a clean title

#### Scenario: Strips wrapping quotes
- **WHEN** the response is `"Draft Q1 email"` (with quotes) or `'Debug auth'`
- **THEN** the surrounding quotes are removed.

#### Scenario: Strips `Title:` prefix
- **WHEN** the response begins with `Title:` (any case)
- **THEN** the prefix is stripped before truncation.

#### Scenario: Truncates over-length titles with ellipsis
- **WHEN** the cleaned title exceeds 60 chars
- **THEN** it is truncated to 57 chars and suffixed with `...`.

#### Scenario: Empty response yields null
- **WHEN** the response trims to empty
- **THEN** `parseTitleResponse` returns `null` so the caller skips the DB update.

### Generate and persist a title

#### Scenario: Generation failure is swallowed
- **WHEN** the Anthropic client throws (network error, missing API key, 429, etc.)
- **THEN** `generateSessionTitle` logs to `console.error` and returns `null`.
- **AND** the caller in session-manager catches and logs but does NOT fail the session.
- **WHY:** auto-naming is purely cosmetic — a session with a 200-char placeholder title is still fully usable.

#### Scenario: Auto-naming runs only on first non-trivial turn
- **WHEN** the session-manager hook fires after an assistant turn
- **THEN** it skips if `session.summary` no longer equals the initial prompt slice (user renamed it, or it already ran).
- **AND** it skips if the agent transcript has fewer than 2 messages.

## Technical Notes

| Concern | Location |
|---|---|
| `TITLE_SYSTEM_PROMPT`, `buildTitlePrompt`, `parseTitleResponse`, `generateSessionTitle` | [server/lib/title-generator.ts](../../../server/lib/title-generator.ts) |
| Caller — auto-naming hook with placeholder guard | `server/lib/session-manager.ts:740-757` |
| Pure-function tests | [server/lib/__tests__/title-generator.test.ts](../../../server/lib/__tests__/title-generator.test.ts) |
| Model identifier | [server/lib/title-generator.ts:85](../../../server/lib/title-generator.ts#L85) |

## History

- Title generation moved from the session model itself to a separate Haiku call to avoid bloating the session's token usage and to keep the title independent of session credentials.
- The "skip if `session.summary !== initialSummary`" guard was added after a regression where a manually-renamed session was overwritten on the next assistant turn.
