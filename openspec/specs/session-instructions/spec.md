# Session Instructions

## Purpose

A single behavioural-instruction string (`SESSION_INSTRUCTIONS`) appended to the system prompt of every inbox-driven agent session. This is the inbox app's CLAUDE.md equivalent — it teaches the agent how to behave inside the inbox UI: trust the credential proxy, fetch full source data before responding, emit one `render_output` per artifact, update by re-titling, choose the right output format, and ask questions through `AskUserQuestion` instead of plain text.

## Context

### Why a static string, not a templated builder
The instructions are app-wide, not session-specific. Per-session content (file manifest, source context) is concatenated alongside this string by the session manager (`[SESSION_INSTRUCTIONS, context].filter(Boolean).join("\n\n")`). Keeping this slice as a `const` in its own module makes it diffable in PRs, easy to A/B test, and impossible to accidentally parameterise into a multi-shape mess.

### Why these specific six instructions
Each rule maps to a class of failure observed in production:
1. **Auth via proxy** — agents would otherwise look for env vars and refuse to act.
2. **Read source first** — agents would respond to summaries and miss thread tails.
3. **One `render_output` per artifact** — agents would chain multiple outputs into a single markdown blob, breaking the panel-per-output UI.
4. **Update by same title** — agents would leave a v1 alongside the corrected v2, cluttering the panel list.
5. **Pick the right format** — agents would default to `markdown` for everything; tables and charts were silently underused.
6. **`AskUserQuestion` for input** — agents would ask "should I proceed?" in prose, which the user can't answer with a button.

### Why authentication guidance is first
The most disruptive failure mode was an agent halting on "I don't have a Notion token" or asking the user to paste credentials. Putting the proxy explanation at the top of the system prompt suppresses that path before any other reasoning happens.

### Why instructions reference UI affordances by name
`render_output`, `AskUserQuestion`, `panel` are real surface-area names — the agent is being told "this tool's `title` field is the dedupe key", not abstract advice. Concrete vocabulary keeps the instructions short and unambiguous.

### What is NOT in scope
- The render-output tool implementation → `artifacts-and-render-tools` and `session-views-controller`.
- The `AskUserQuestion` tool registration → `session-manager`.
- Per-session source-context payloads (email thread, Notion task) appended after this string → owned by the plugin or `session-manager`.
- The credential proxy itself → `credential-proxy` spec.

## Requirements

### Module shape

#### Scenario: Single named export `SESSION_INSTRUCTIONS`
- **WHEN** any module imports from `session-instructions.ts`
- **THEN** the only export is `SESSION_INSTRUCTIONS: string` — the string is the entire module's contract.

#### Scenario: Consumed only by `session-manager` via `appendSystemPrompt`
- **WHEN** the session manager builds the agent's system prompt
- **THEN** it composes `[SESSION_INSTRUCTIONS, context].filter(Boolean).join("\n\n")` and passes the result to the Agent SDK's `appendSystemPrompt` field.
- **AND** no other module reads or rewrites this string at runtime.

### Instruction content

#### Scenario: Authentication delegated to the credential proxy
- **WHEN** the agent reads the system prompt
- **THEN** it is told that all API credentials are injected by the credential proxy and that skill scripts can call third-party APIs without supplying tokens.
- **WHY:** without this, agents stall asking for credentials they will never receive directly.

#### Scenario: Source-context handling rule
- **WHEN** the session was triggered with a source (email thread, Notion task, Gorgias ticket)
- **THEN** the agent is told to fetch the full source via the appropriate skill before responding — the inline source summary is a hint, not a substitute.

#### Scenario: External artifacts must include a direct URL
- **WHEN** the agent creates or modifies an external resource (Gmail draft, Shopify order, Notion page, Gorgias reply)
- **THEN** it is told to include the resource's direct URL in its output.

#### Scenario: One artifact per `render_output`
- **WHEN** the agent has multiple distinct outputs to surface
- **THEN** it is told to call `render_output` once per artifact — never to combine multiple outputs into a single markdown block.
- **WHY:** the UI maps each `render_output` to its own expandable panel; a fused output collapses into a single panel and loses navigation affordances.

#### Scenario: Updates use the same `title`
- **WHEN** the agent needs to fix or replace a previously rendered output
- **THEN** it is told to call `render_output` again with the same `title` — the renderer dedupes by title and replaces the prior version.
- **AND** the agent is told never to leave broken or superseded outputs in the session.

#### Scenario: `render_output` type selection guidance
- **WHEN** the agent is choosing a `render_output` type
- **THEN** the prompt enumerates: `table` (structured rows), `json` (raw data), `markdown` (formatted text), `html` (custom styling), `chart` (visualisation), `react` (custom UI not fitting the others).
- **AND** the `react` clause specifies `data` must be `{ code: "<JSX string>" }`, not a raw data object.

#### Scenario: User input flows through `AskUserQuestion`
- **WHEN** the agent needs any input from the user
- **THEN** it is told to use the `AskUserQuestion` tool — never to embed questions in plain text.
- **AND** this rule covers proposing actions, confirming plans, and clarification — not just open-ended questions.

## Technical Notes

| Concern | Location |
|---|---|
| The instruction string itself | [server/lib/session-instructions.ts](../../../server/lib/session-instructions.ts) |
| The session manager that prepends it to every system prompt | `server/lib/session-manager.ts` |

## History

- The "always use `AskUserQuestion`" rule was added after agents repeatedly asked "shall I proceed?" in markdown output, leaving the user with no buttonised path to respond — and turning the next session message into an unrelated continuation.
- The `update-by-same-title` rule replaced a "delete the old output" instruction that the agent could not actually execute (no delete tool); re-titling-as-replace was the path the renderer already supported.
- The `react` clause's `{ code: "<JSX string>" }` reminder was added after multiple sessions tried to pass raw data objects as `data` for the `react` type, breaking the artifact transform pipeline at parse time.
- The credential-proxy first-paragraph placement was demoted from a later position after a quarterly review found ~12% of failed sessions stalled on auth-related questions in the first turn.
