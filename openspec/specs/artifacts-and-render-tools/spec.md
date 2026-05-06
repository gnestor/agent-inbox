# Artifacts and Render Tools

## Purpose

Server-side MCP tools (`create_file`, `present_files`) that let the agent author renderable artifacts, plus the parent-side pipeline that turns a `create_file` payload into a sandboxed iframe: JSX → `React.createElement` transform, HTML document with import map and Tailwind CDN, postMessage bridge for actions/state/height/wheel, and a pub-sub store that lets a code-editor panel mutate the artifact in place.

## Context

### Why MCP tools mirror Claude.ai's artifact interface
The agent has been trained on `create_file` + `present_files` as the artifact authoring pattern (Claude.ai web UI). Reusing the same names and JSDoc shape means we leverage the model's prior — no extra system-prompt nudging, no hand-rolled tool schema the model has to learn. The frontend just watches for `present_files` tool_use blocks and looks up the matching `create_file` payload by id.

### Why the JSX transform runs in the parent, not the iframe
`@babel/standalone` is ~37 MB. Loading it once in the parent (lazily, on first artifact view) lets every subsequent artifact reuse the same module; loading it per-iframe would multiply that cost by every artifact in a session. The transform runs through React Query keyed by source code so identical artifacts hit the cache instantly.

### Why imports are filtered to a tiny allowlist
The iframe has no bundler — packages must resolve through the import map (`react`, `react-dom`, `@hammies/frontend/*`, `recharts`, `lucide-react`, `d3`, `lodash`). LLMs routinely hallucinate imports (`from 'antd'`, `from 'classnames'`); silently dropping non-allowlisted imports keeps the artifact runnable instead of throwing `Failed to resolve module specifier`.

### Why React/`@hammies/frontend`/`cn` imports are auto-injected
Models often forget `import { useState } from 'react'` or destructure components from a hallucinated `Components` global. Rather than fail, the transform scans the body for known React APIs and `@hammies/frontend` component names and prepends a single consolidated import line. Side-effect: artifacts can be written as bare JSX with no imports at all and still work.

### Why a bare top-level `return` is wrapped in `App`
The model frequently writes `return <div>...</div>` at column 0 instead of declaring a component. The transform detects this (unindented `return` keyword) and synthesizes `export default function App() { ...body... }` so mounting succeeds. Imports stay at top level — the wrapper only encloses the body.

### Why iframe sandbox is `allow-scripts allow-same-origin`
The artifact must execute JS (`allow-scripts`) and load ES modules from the parent origin via the import map (`allow-same-origin`). `srcDoc` gives the iframe a *null* origin for cookie/storage purposes, so even with `allow-same-origin` the artifact cannot read parent cookies or `localStorage`. CSP further restricts `connect-src` to esm.sh/jsdelivr only — no fetch back into our API.

### Why theme variables sync via `MutationObserver`
Artifacts must match the parent's theme (light/dark, color tokens) without inheriting the parent's CSS (different document). The iframe reads computed CSS variables from `window.parent.document.documentElement` on load and re-syncs whenever the parent's `class` attribute changes (theme toggle). `MutationObserver` is the only way to react to a class flip on a DOM node we don't own.

### Why height is reported via postMessage, not CSS
The parent needs to size the iframe to its content (content height varies wildly per artifact — 200 px chart vs 800 px table). The iframe measures `document.body.scrollHeight` after two `requestAnimationFrame` ticks (so layout settles) and posts `{ type: "height" }`. A 2 s fallback timer ensures even a script-error iframe eventually reports something — otherwise the host would render a permanent skeleton.

### Why `srcDocCache` and `artifactHeightCache` are bounded Maps
Long sessions can accumulate hundreds of artifact mounts. Without bounds, the parent leaks one full HTML document per artifact (could be 100 KB+ each). Caps of 50 (srcDoc) and 500 (height) with FIFO eviction keep memory bounded while still avoiding rebuilds for the most recent artifacts.

### Why `useEditingCode` is a `useSyncExternalStore` pub-sub, not React Query
The code editor panel (producer) writes raw JSX as the user types; the artifact panel (consumer) re-transforms and re-renders on each keystroke. React Query would force every keystroke through the network layer or a dummy `queryFn`; a Map + listener Set gives synchronous, in-memory updates with `useSyncExternalStore`'s tearing-free subscription semantics.

### What is NOT in scope
- Persisting artifact code to the JSONL transcript → `session-files` / `session-streaming` specs (the JSONL is the authoritative source — see Memory note `project_inbox_artifact_source_of_truth.md`).
- Rendering non-React artifact types (`.html`, `.md`, `.svg`) → handled in transcript renderers under `session-views-controller`.
- The `present_files` → `create_file` lookup logic in the transcript view → `session-views-controller`.
- The iframe theme variable list and base CSS → `shared-ui-components` (`iframe-theme.ts`).

## Requirements

### MCP tool server (`server/lib/artifact-tools.ts`)

#### Scenario: `create_file` and `present_files` are the only artifact tools
- **WHEN** the agent SDK is started with the artifact MCP server attached
- **THEN** the server registers exactly two tools — `create_file(description, path, file_text)` and `present_files(filepaths[])`.
- **AND** `create_file`'s schema requires `path` (per convention `/mnt/user-data/outputs/<name>.<ext>`) and `file_text` (the actual content).

#### Scenario: Tool descriptions ship the entire artifact authoring contract
- **WHEN** the agent reads `create_file`'s tool description
- **THEN** the description enumerates supported extensions (`.jsx`, `.html`, `.md`, `.svg`), the available React imports (Tailwind classes, shadcn/ui component list, recharts/lucide/d3/lodash), the project style rules (no `bg-background` on root, `text-sm`/`text-xs` only), and the `sendAction` / `saveState` globals.
- **WHY:** the model writes artifacts purely from the tool description — there is no parent prompt augmenting it.

#### Scenario: Tool handlers return acknowledgement, not the file contents
- **WHEN** `create_file` resolves
- **THEN** the response is `File created: <path> (<size> chars, .<ext>)` — the file content is not echoed back, since the frontend reads it directly from the `tool_use` block in the transcript.

### JSX transform (`src/lib/artifact-transform.ts`)

#### Scenario: Allowlisted package imports survive; everything else is dropped
- **WHEN** the source contains `import X from 'antd'` and `import { useState } from 'react'`
- **THEN** the React import is preserved and the antd line is silently removed (no import resolution failure at runtime).
- **AND** the allowlist is exactly: `react`, `react-dom`, `@hammies/frontend`, `recharts`, `lucide-react`, `d3`, `lodash` (and subpaths thereof).

#### Scenario: Missing React APIs are auto-imported
- **WHEN** the source uses `useState` / `useEffect` / `useMemo` etc. without importing them
- **THEN** the transform consolidates all React imports into one `import React, { ... } from 'react';` line that includes every used API from `REACT_APIS`.
- **AND** existing React imports (default and named) are merged into the same line — no duplicate import statements remain.

#### Scenario: Missing `@hammies/frontend` component imports are auto-injected
- **WHEN** the source references `Card`, `Button`, etc. without importing them and without locally declaring them
- **THEN** a single `import { ... } from '@hammies/frontend/components/ui';` line is prepended including every used `ARTIFACT_COMPONENTS` name.
- **AND** locally declared identifiers (`function Card`, `const Card = ...`) are excluded from auto-import.

#### Scenario: `cn` is auto-imported from `@hammies/frontend/lib/utils`
- **WHEN** the source uses `cn(...)` without importing it
- **THEN** `import { cn } from '@hammies/frontend/lib/utils';` is prepended.
- **WHY:** importing `cn` from both `lib/utils` and `components/ui` produces a duplicate-identifier compile error — the transform always uses the canonical `lib/utils` path.

#### Scenario: Hallucinated destructuring from globals is stripped
- **WHEN** the source contains `const { Card, Button } = Components`
- **THEN** the line is removed (it would reference an undefined global).
- **AND** the deleted bindings are subsequently re-imported from `@hammies/frontend/components/ui` via the auto-injection pass.

#### Scenario: Bare top-level `return` is wrapped in `App`
- **WHEN** the source has an unindented `return <div>...</div>` and no `export default`
- **THEN** `exportedName` is set to `"App"` and the body is wrapped in `export default function App() { ... }` — imports stay at file top.

#### Scenario: `export default` is detected for mounting
- **WHEN** the source contains `export default function MyComp() {}` or `export default MyComp;`
- **THEN** `exportedName` is `"MyComp"` and the host iframe HTML mounts `<MyComp />`.

#### Scenario: JSX → `React.createElement` via `@babel/standalone`
- **WHEN** the cleanup passes are complete
- **THEN** the code is run through Babel with `presets: ["react"], sourceType: "module"`.
- **AND** `@babel/standalone` is dynamic-imported on first call (it is ~37 MB) and the transform function is cached for subsequent calls.

#### Scenario: Common LLM regex bug is patched
- **WHEN** the source contains `/\n/g` literally split across lines (a common LLM artifact)
- **THEN** the transform rewrites it to a single-line `/\\n/g` before Babel sees it.

#### Scenario: `escapeForScript` neutralises `</script>` for inline embedding
- **WHEN** the transformed code is about to be embedded inside `<script type="module">...</script>`
- **THEN** every `</script` substring is rewritten to `<\/script` so the parser cannot exit the script context.

### Iframe HTML builder (`src/lib/build-artifact-html.ts`)

#### Scenario: Document includes import map, Tailwind CDN, theme @theme block
- **WHEN** `buildArtifactHtml(code, title, exportedName, transformError)` runs
- **THEN** the returned HTML contains an `<script type="importmap">` mapping `react`, `react-dom`, `@hammies/frontend/*` to same-origin `/@hammies/*.mjs` URLs and `recharts`/`lucide-react`/`d3`/`lodash` to esm.sh URLs.
- **AND** Tailwind CDN is loaded via `<script src="${origin}/@hammies/tailwindcss.js">` and a `@theme inline { ... }` block declares colour/radius/font tokens that mirror parent CSS variables.

#### Scenario: CSP restricts code execution and network
- **WHEN** the document is rendered
- **THEN** the meta CSP allows scripts only from same-origin + esm.sh + jsdelivr; styles inline + same-origin; `connect-src` limited to esm.sh / jsdelivr; `default-src 'none'`.
- **WHY:** without an explicit CSP the iframe could `fetch('/api/...')` and exfiltrate session data via `allow-same-origin`.

#### Scenario: Theme vars sync from parent on load and on theme change
- **WHEN** the iframe loads
- **THEN** the inline script reads `window.parent.getComputedStyle(window.parent.document.documentElement)` for every name in `THEME_VARS_JSON` and copies the values to its own `<html>` element.
- **AND** a `MutationObserver` on the parent's `<html>` `class` attribute re-runs the sync when the user toggles dark mode.

#### Scenario: postMessage bridge implements `sendAction` / `saveState` / `restore`
- **WHEN** the artifact calls `sendAction(intent, data)`
- **THEN** the iframe posts `{ type: "action", intent, data }` to the parent.
- **WHEN** the artifact calls `saveState(state)`
- **THEN** the iframe posts `{ type: "state", state }` for the parent to persist.
- **WHEN** the parent posts `{ type: "restore", state }` (after iframe `load`)
- **THEN** the iframe invokes `window.__onStateRestored(state)` if defined.

#### Scenario: Wheel events bubble to the parent only when the inner element cannot scroll
- **WHEN** the user scrolls horizontally inside the iframe
- **THEN** if the wheel target (or any ancestor) has `scrollWidth > clientWidth`, the event stays in the iframe.
- **AND** otherwise the iframe forwards `{ type: "wheel", deltaX, deltaY }` to the parent and `preventDefault()`s — so panel-level horizontal navigation works through artifacts.

#### Scenario: Errors are forwarded as overlay-able events
- **WHEN** the iframe throws (`error`) or rejects (`unhandledrejection`)
- **THEN** the message posts `{ type: "error", message }` to the parent so the parent can swap the iframe for a destructive `<pre>` block.

#### Scenario: Height reports after layout settles, with a 2 s fallback
- **WHEN** the artifact mounts successfully
- **THEN** after two `requestAnimationFrame` ticks `__reportHeight()` posts `{ type: "height", height: document.body.scrollHeight }` exactly once (`__heightReported` guard).
- **AND** if the module script fails to parse/import, a `setTimeout(2000)` fallback fires the same report so the host never stays in skeleton state forever.

#### Scenario: Wide tables get a horizontal scroll wrapper
- **WHEN** the artifact contains `<table>` or `[data-slot="table"]`
- **THEN** each table is wrapped in a `<div class="table-scroll-wrap">` with `overflow-x: auto`, the table loses `w-full` and gains `width: max-content; min-width: 100%`.
- **WHY:** wide tables would otherwise force the iframe to widen and trigger the wheel-forward path, breaking horizontal table scroll.

#### Scenario: Mount uses `exportedName` if known, falls back to `App`, else shows "No component found"
- **WHEN** the module script runs
- **THEN** it reads `typeof <exportedName>` (or `App`); if defined it calls `createRoot(root).render(React.createElement(...))`, otherwise sets `root.textContent = 'No component found'`.

### `<ArtifactFrame>` (`src/components/session/ArtifactFrame.tsx`)

#### Scenario: Transform is cached forever per source string
- **WHEN** the same artifact code is rendered multiple times across remounts
- **THEN** `useQuery({ queryKey: ["artifact-transform", code], staleTime: Infinity, gcTime: 10*60_000, retry: false })` reuses the prior transform without re-running Babel.

#### Scenario: Last valid transform is shown during edit-time syntax errors
- **WHEN** the user is typing in the code editor and the source is momentarily invalid
- **THEN** `lastValidRef` retains the previous good `code`/`exportedName` so the iframe keeps rendering the prior version while the error overlay is shown.

#### Scenario: `srcDoc` is cached per `(sessionId, sequence, transformedCode)` triple, capped at 50
- **WHEN** the user revisits an artifact already rendered earlier in the session
- **THEN** `srcDocCache.get(cacheKey)` returns the prior HTML document and the iframe doesn't rebuild.
- **AND** when a new transformed code arrives for the same `(sessionId, sequence)`, all earlier entries with that prefix are evicted to prevent stale duplicates.
- **AND** when the cache reaches `SRCDOC_CACHE_MAX = 50`, the oldest entry is dropped (FIFO).

#### Scenario: Reported heights are cached at `(sessionId, sequence)`, capped at 500
- **WHEN** an artifact reports its height
- **THEN** `artifactHeightCache.set(\`${sessionId}:${sequence}\`, height)` is called so a remount sizes the iframe correctly *before* the live postMessage arrives — no layout shift.
- **AND** the cache is capped at 500 entries (FIFO eviction).

#### Scenario: Iframe stays hidden until the live height report arrives
- **WHEN** the iframe mounts
- **THEN** `heightReported` is initially false; the iframe is rendered with `opacity-0 absolute inset-0` and a `<Skeleton>` covers it.
- **AND** the height *cache* sizes the skeleton/iframe correctly (no flash to default 200 px) but the *live* report flips visibility (no blank-iframe flash before mount completes).

#### Scenario: Action intents become `<artifact_action>` strings
- **WHEN** the iframe posts `{ type: "action", intent, data }`
- **THEN** the host strips `<>"&` from `intent`, JSON-stringifies `data` if present, and emits `<artifact_action intent="${intent}">${payload}</artifact_action>` to `onAction` — the upstream session view turns this into a session-resume prompt.

#### Scenario: Saved state restores via postMessage on `load`
- **WHEN** the iframe fires `load` and `savedState` (from `usePreference` keyed `artifact:${sessionId}:${sequence}`) is non-empty
- **THEN** the host posts `{ type: "restore", state: savedState }` to the iframe's `contentWindow`.
- **AND** subsequent `{ type: "state" }` messages from the iframe write back through `setSavedState`.

#### Scenario: Compile or runtime errors render as a destructive in-flow block
- **WHEN** `transformError` is set or the iframe posts a runtime `error`
- **THEN** the iframe is unmounted and a `bg-destructive` `<pre>` shows the message instead — keeping the error in normal document flow so transcript content below isn't covered.

#### Scenario: Wheel forwarding from iframe to parent
- **WHEN** the iframe posts `{ type: "wheel", deltaX, deltaY }`
- **THEN** the host dispatches a synthetic `WheelEvent` on the iframe element with `bubbles: true`, letting parent scroll handlers (e.g. PanelStack horizontal nav) react.

### Editor pub-sub (`src/hooks/use-artifact-editor.ts`)

#### Scenario: `setEditingCode` notifies all subscribers synchronously
- **WHEN** the code editor panel calls `setEditingCode(key, code)` on every keystroke
- **THEN** every subscriber registered via `useEditingCode(key)` re-renders via `useSyncExternalStore` in the same tick.

#### Scenario: Listener sets are cleaned up when last subscriber unmounts
- **WHEN** the last `useEditingCode(key)` unmounts
- **THEN** the listener `Set` is removed from the `listeners` Map (no leaked empty Sets).

#### Scenario: `artifactEditorKey(sessionId, sequence)` is the canonical key
- **WHEN** a producer and consumer want to share the same artifact's edit buffer
- **THEN** both call `artifactEditorKey(sessionId, sequence)` to derive `"artifact:${sessionId}:${sequence}"` — same format as the `usePreference` and `srcDocCache` keys.

### Syntax highlighting helpers

#### Scenario: `rehype-highlight` loads lazily and triggers a re-render
- **WHEN** any component first imports `lazy-rehype-highlight`
- **THEN** the module dynamically imports `rehype-highlight`, `highlight.js/lib/core`, and `highlight.js/lib/languages/json`, registers the JSON language, and notifies subscribers.
- **AND** components using `useRehypeHighlight()` re-render once the plugin list flips from `[]` to `[mod.default]` so already-rendered code blocks pick up highlighting.

#### Scenario: `hastToHtml` serialises lowlight HAST without external deps
- **WHEN** server-side or non-React code paths need highlighted HTML
- **THEN** `hastToHtml(tree)` walks the tree, escaping text and emitting `<span class="...">` for elements — supporting only the `text` and `span`-element nodes lowlight produces.
- **WHY:** pulling `hast-util-to-html` (full HAST serialiser) for this trivial subset would add a dependency for code we already understand.

## Technical Notes

| Concern | Location |
|---|---|
| MCP `create_file` / `present_files` tool definitions | [server/lib/artifact-tools.ts](../../../server/lib/artifact-tools.ts) |
| JSX → `React.createElement` transform, import filtering, auto-injection, App-wrapper, `escapeForScript` | [src/lib/artifact-transform.ts](../../../src/lib/artifact-transform.ts) |
| Iframe HTML document, CSP, import map, theme sync, postMessage bridge, height/error/wheel handlers | [src/lib/build-artifact-html.ts](../../../src/lib/build-artifact-html.ts) |
| `<ArtifactFrame>` host: transform query, `srcDoc` cache, height cache, postMessage handling, error overlay | [src/components/session/ArtifactFrame.tsx](../../../src/components/session/ArtifactFrame.tsx) |
| Code-editor pub-sub for live artifact editing | [src/hooks/use-artifact-editor.ts](../../../src/hooks/use-artifact-editor.ts) |
| Lazy `rehype-highlight` loader with `useSyncExternalStore` re-render hook | [src/lib/lazy-rehype-highlight.ts](../../../src/lib/lazy-rehype-highlight.ts) |
| Minimal HAST → HTML serialiser for lowlight output | [src/lib/hast-html.ts](../../../src/lib/hast-html.ts) |
| Iframe theme variable list and base CSS (consumed by `build-artifact-html.ts`) | `src/lib/iframe-theme.ts` |
| In-process MCP server registering the `render_output` tool | [server/lib/render-output-tool.ts](../../../server/lib/render-output-tool.ts) |
| `<OutputRenderer>` transcript/panel renderer for `render_output` payloads | [src/components/session/OutputRenderer.tsx](../../../src/components/session/OutputRenderer.tsx) |
| `<InboxResultPanel>` panel host for an output rendered to its own panel | [src/components/session/InboxResultPanel.tsx](../../../src/components/session/InboxResultPanel.tsx) |
| `<CodeEditorPanel>` live artifact code editor (writes back to JSONL) | [src/components/session/CodeEditorPanel.tsx](../../../src/components/session/CodeEditorPanel.tsx) |
| Iframe auto-height + theme-variable forwarding hook | [src/hooks/use-iframe-auto-height.ts](../../../src/hooks/use-iframe-auto-height.ts) |

## History

- Babel was originally bundled into the main app; lazy-loading shipped after a profiler showed the cold-start TTI dominated by parsing `@babel/standalone` for users who never opened an artifact.
- Auto-injection of React/`@hammies/frontend`/`cn` imports replaced a hard error on missing imports — half of model-written artifacts forgot at least one import, producing 500 ms of red-overlay before an otherwise valid component.
- The `App`-wrapper for bare top-level `return` was added after several agents wrote `return <div/>` at column 0 (Claude.ai's REPL-style affordance bleeding through).
- `srcDocCache` / `artifactHeightCache` were unbounded; long sessions leaked enough HTML to OOM the tab. Caps + FIFO eviction fixed it without observable user-facing regression.
- The iframe was originally hidden via `display: none` until height reported; switched to `opacity-0 absolute inset-0` so layout was committed and the first paint was instant when visibility flipped.
- Wheel forwarding originally fired on every horizontal wheel; tables with `overflow-x: auto` lost their own scroll until the ancestor-scrollable check was added.
- The 2 s height fallback was added after a bug where a syntax error in the module script left the parent showing an indefinite skeleton — the regular height-report path never ran.
- `useEditingCode` was first a `useState` lifted into a context; converting to `useSyncExternalStore` + a Map removed a parent re-render on every keystroke that bled into the rest of the panel tree.
