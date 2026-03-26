# Custom XML Tags & Rich Output

The inbox renders structured content from agent sessions using two mechanisms: **custom XML tags** embedded in assistant text blocks, and the **`render_output` MCP tool** for rich inline outputs. This document covers every custom tag, rich output type, and the React artifact system.

## Architecture Overview

```
Agent (text/tool_use blocks)
  │
  ├─ Text blocks with XML tags ──► extractXmlTag() ──► ContextPanel / InboxResultPanel / PanelWidget
  │
  └─ tool_use: render_output ──► OutputRenderer ──► Markdown / HTML / Table / JSON / Chart / File / Conversation / ArtifactFrame
```

Parsing happens in `ContentBlockView` ([SessionTranscript.tsx:590](src/components/session/SessionTranscript.tsx#L590)). Each text block is checked for known XML tags in order. If found, the tag content is parsed as JSON and rendered by a specialized component; any remaining text outside the tag renders as markdown.

The utility function `extractXmlTag()` ([SessionTranscript.tsx:952](src/components/session/SessionTranscript.tsx#L952)) handles extraction:

```ts
function extractXmlTag(text: string, tag: string): string | null {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  return match ? match[1].trim() : null
}
```

---

## Custom XML Tags

### `<inbox-context>`

Structured context block emitted by workflow agents to display entity information and related resources.

**Format:** `<inbox-context>{ JSON }</inbox-context>`

**Rendering component:** `ContextPanel` ([ContextPanel.tsx](src/components/session/ContextPanel.tsx))

**Type definition:** `InboxContextData` ([types/index.ts:127](src/types/index.ts#L127))

```ts
interface InboxContextData {
  entity: {
    type: "person" | "company" | "topic"
    name: string
    email: string | null
    domain: string | null
    company: string | null
    role: string | null
  }
  source: {
    type: "email" | "task"
    id: string
    threadId: string | null
    subject: string | null
    from: string | null
    date: string | null
    snippet: string
  }
  contextPages: Array<{ file: string; title: string; summary: string; tags: string[] }>
  relatedThreads: Array<{ threadId: string; subject: string; date: string; snippet: string }>
  relatedTasks: Array<{ id: string; title: string; status: string; url: string }>
  summary: string
}
```

**UI:** Renders an entity header with icon (person/company/topic), a summary section, and collapsible accordion sections for context pages, related threads, and related tasks. Threads and tasks are clickable — they navigate to the corresponding inbox tab and item.

---

### `<inbox-result>`

Final action result from a workflow session. Displays the outcome and provides interactive controls (e.g. save draft, mark task complete).

**Format:** `<inbox-result>{ JSON }</inbox-result>`

**Rendering component:** `InboxResultPanel` ([InboxResultPanel.tsx](src/components/session/InboxResultPanel.tsx))

**Type definition:** `InboxResultData` ([types/index.ts:153](src/types/index.ts#L153))

```ts
type InboxResultAction = "draft" | "task" | "context_updated" | "skipped"

interface InboxResultData {
  action: InboxResultAction
  draft?: { to: string; subject: string; body: string; threadId: string | null; inReplyTo: string | null }
  task?: { id: string; title: string; status: string; url: string }
  contextUpdated?: string[]
  summary: string
}
```

**Sub-components by action:**

| Action | Component | UI |
|--------|-----------|-----|
| `draft` | `DraftResult` | Email compose card with To/Subject header, `RichTextEditor` for body, "Save Draft" button that calls `createDraft()` |
| `task` | `TaskResult` | Task title + status badge, "Mark Complete" button that calls `updateTask()`, "Open in Notion" link |
| `context_updated` | `ContextUpdatedResult` | Lists updated context file paths with summary |
| `skipped` | `SkippedResult` | Displays summary text only (or nothing if no summary) |

---

### `<artifact_action>`

User message generated when a React artifact calls `sendAction()`. Parsed as a user message, not an assistant text block.

**Format:** `<artifact_action intent="intent_name">{ JSON payload }</artifact_action>`

**Parsing:** Regex match on user message text ([SessionTranscript.tsx:464](src/components/session/SessionTranscript.tsx#L464))

**Rendering component:** `ArtifactActionDetail` (inline in SessionTranscript.tsx) — displayed as a collapsed accordion entry labeled "Send action" showing the intent and payload.

**Flow:** React artifact iframe calls `sendAction(intent, data)` → `postMessage` to parent → `ArtifactFrame` constructs the XML string → session resume sends it as a user message → agent receives the intent and payload.

---

### `<ide_opened_file>` / `<ide_selection>`

IDE context injected when a session is created from the Claude Code VS Code extension.

**Format:**
```
<ide_opened_file>The user opened the file /path/to/file in the IDE</ide_opened_file>
<ide_selection>The user selected the lines 10 to 20 from /path/to/file:</ide_selection>
```

**Parsing:** `parseIdeContext()` ([SessionTranscript.tsx:979](src/components/session/SessionTranscript.tsx#L979))

**Rendering:** File/selection badges shown below the user message bubble — small pills with a file icon, filename, and optional line range (e.g. `file.ts:10-20`).

---

### Dynamic Workflow Panel Tags

Extensible custom tags registered by workflow plugins via `inbox-panels.json` files.

**Format:** `<tag-name>{ JSON }</tag-name>` (tag name defined in the panel schema)

**Registration:** Workflow plugins declare panels in `{workspace}/workflows/{name}/inbox-panels.json`. The server loads these at startup and exposes them via `GET /api/sessions/panel-schemas`.

**Rendering component:** `PanelWidget` ([PanelWidget.tsx](src/components/plugin/PanelWidget.tsx))

**Type definition:** `PanelSchema` and `WidgetDef` ([types/panels.ts](src/types/panels.ts))

**Widget types available:**

| Widget Type | Description | Data Shape |
|-------------|-------------|------------|
| `kv-table` | Key-value metadata table | `fields: string[]` — dot-paths into JSON data |
| `prose` | Markdown/HTML rendered content | `field: string`, optional `format: "html" \| "markdown"` |
| `badge-row` | Inline badge strip | `field: string` — string or string[] |
| `action-buttons` | Mutation action buttons | `actions: Array<{ label, mutation, payloadField?, variant? }>` |
| `json-tree` | Collapsible JSON tree viewer | `field: string` |
| `data-table` | Tabular data with columns | `field: string`, optional `columns` |
| `chart` | Recharts visualization | `field, chartType, xKey, yKeys` |
| `vega-lite` | Vega-Lite visualization | `field: string` |
| `image` | Full-width image | `field: string`, optional `alt` |
| `code-block` | Syntax-highlighted code | `field: string`, optional `language` |
| `attachment-list` | File attachments with download links | `field: string` — array of `{ name, url }` |
| `item-list` | Navigable related items | `field: string`, optional `sourceId` |
| `mime` | MIME bundle renderer (text/html, image/*, etc.) | `field: string` |

**Example `inbox-panels.json`:**

```json
{
  "github-issue-context": [
    { "type": "kv-table", "fields": ["title", "state", "author", "labels"] },
    { "type": "badge-row", "field": "labels" },
    { "type": "prose", "field": "body" }
  ],
  "github-issue-result": [
    { "type": "prose", "field": "summary" },
    { "type": "action-buttons", "actions": [
      { "label": "Close Issue", "mutation": "close-issue", "variant": "destructive" }
    ]}
  ]
}
```

---

## Rich Output Types (`render_output` tool)

The `render_output` MCP tool ([render-output-tool.ts](server/lib/render-output-tool.ts)) is registered as an in-process MCP server. When the agent calls this tool, the server returns a brief acknowledgment. The frontend detects `block.name === "render_output"` in the transcript and renders the output inline using `OutputRenderer` ([OutputRenderer.tsx](src/components/session/OutputRenderer.tsx)).

Outputs appear inline in the transcript (600px max height) inside a collapsible accordion. They can be expanded to a dedicated panel.

**Type definition:** `OutputSpec` ([OutputRenderer.tsx:13](src/components/session/OutputRenderer.tsx#L13))

### `markdown`

Rendered with `ReactMarkdown` + `remark-gfm` + `rehype-highlight`.

```ts
{ type: "markdown", data: "## Hello\n\nSome **bold** text", title?: "Report" }
```

### `html`

Rendered in a sandboxed iframe (`sandbox="allow-scripts"`, 300px height).

```ts
{ type: "html", data: "<h1>Hello</h1><p>Raw HTML content</p>", title?: "Preview" }
```

### `table`

Rendered with the `DataTable` component.

```ts
{ type: "table", data: { columns: ["Name", "Score"], rows: [["Alice", 95], ["Bob", 87]] }, title?: "Results" }
```

### `json`

Rendered as a collapsible tree view (`JsonTree`) with color-coded types: green for numbers, blue for strings, red/green for booleans. Nodes deeper than level 1 start collapsed.

```ts
{ type: "json", data: { users: [{ name: "Alice", active: true }] }, title?: "API Response" }
```

### `chart`

Rendered with Recharts via shadcn's `ChartContainer`. Supports bar, line, area, and pie charts. Also accepts simple Vega-Lite specs for backward compatibility (complex Vega-Lite should use `type: "react"` with vega-embed).

```ts
{
  type: "chart",
  data: {
    type: "bar",                    // "bar" | "line" | "area" | "pie"
    data: [{ month: "Jan", revenue: 100 }, { month: "Feb", revenue: 150 }],
    xKey: "month",
    yKeys: ["revenue"],
    labels: { revenue: "Monthly Revenue" },    // optional
    colors: { revenue: "#4f46e5" }             // optional, defaults to chart-1..chart-5
  },
  title?: "Revenue"
}
```

### `file`

Displays a file attachment bar with download link. Inline preview for images (png, jpg, gif, webp, svg, avif, ico), video (mp4, webm, ogg), and HTML files. Code files show a code icon.

```ts
{ type: "file", data: { name: "report.pdf", path: "/path/to/report.pdf", mimeType?: "application/pdf" }, title?: "Report" }
```

### `conversation`

Rendered as chat bubbles with user/bot icons. User messages align left with muted background, bot messages align right with card border.

```ts
{
  type: "conversation",
  data: { messages: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi there!" }] },
  title?: "Chat Log"
}
```

### `react`

Sandboxed React artifact rendered in an iframe. This is the most powerful output type — supports full React components with hooks, Tailwind CSS, and shadcn/ui components from `@hammies/frontend`.

```ts
{ type: "react", data: { code: "export default function App() { return <div>Hello</div> }", title?: "My App" } }
```

See the [React Artifacts](#react-artifacts) section below for full details.

---

## React Artifacts

React artifacts are interactive React components written by the agent, rendered in a sandboxed iframe with the app's design system.

### Key Files

| File | Purpose |
|------|---------|
| [ArtifactFrame.tsx](src/components/session/ArtifactFrame.tsx) | Parent component — manages iframe lifecycle, postMessage bridge, state persistence |
| [artifact-transform.ts](src/lib/artifact-transform.ts) | JSX transform — converts agent code to vanilla JS via `@babel/standalone` |
| [build-artifact-html.ts](src/lib/build-artifact-html.ts) | Builds the iframe HTML document with import maps, Tailwind, theme sync |

### Security Model

- `sandbox="allow-scripts allow-same-origin"` — enables ES module imports via import map
- CSP restricts `connect-src` to esm.sh and cdn.jsdelivr.net only
- `srcDoc` gives the iframe a null origin — no access to parent cookies/localStorage
- Action intents flow out via `postMessage` and are translated to session resumes

### Code Transform Pipeline

1. **Import filtering** — only `react`, `react-dom`, and `@hammies/frontend` imports are kept; all others are stripped
2. **Auto-injection** — missing React hooks and `@hammies/frontend` component imports are detected and added automatically
3. **JSX transform** — `@babel/standalone` converts JSX to `React.createElement` calls
4. **Export detection** — the default-exported component name is extracted for mounting

### Available in Artifact Code

**Components** (imported from `@hammies/frontend/components/ui`): Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Badge, Input, Textarea, Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Separator, Switch, Checkbox, Tabs, TabsList, TabsTrigger, TabsContent, Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption, Skeleton, Progress, Avatar, AvatarImage, AvatarFallback, Accordion, AccordionItem, AccordionTrigger, AccordionContent, Alert, AlertTitle, AlertDescription, Toggle, ToggleGroup, ToggleGroupItem, RadioGroup, RadioGroupItem, Spinner, cn.

**React hooks** (auto-injected if used): useState, useEffect, useRef, useCallback, useMemo, useReducer, useContext, createContext, forwardRef, memo, Fragment, useId, useTransition, useDeferredValue, startTransition.

**Global functions** (available without import):

| Function | Signature | Purpose |
|----------|-----------|---------|
| `sendAction` | `(intent: string, data?: object) => void` | Sends a message to the session. The agent receives `<artifact_action intent="...">{ data }</artifact_action>`. |
| `saveState` | `(state: object) => void` | Persists UI state across page reloads. Restored on remount via `window.__onStateRestored` callback. |

### Theme Sync

The iframe syncs CSS variables from the parent document at load time and observes class changes on `<html>` (for dark/light mode toggling). Forwarded variables include all shadcn theme tokens: background, foreground, card, primary, secondary, muted, border, accent, destructive, chart-1 through chart-5, radius, font-sans, font-mono.

### State Persistence

Artifact UI state is stored in user preferences under the key `artifact:{sessionId}:{sequence}`. On remount, saved state is pushed back to the iframe via `postMessage` with type `restore`. Artifacts listen for this via `window.__onStateRestored`.

### Height Reporting

The iframe reports its content height to the parent via `postMessage({ type: "height", height })`. The parent caps the iframe at 600px in inline mode. A fallback timer reports height after 2 seconds if the module script fails. Heights are cached in memory (`artifactHeightCache`, capped at 500 entries) to prevent layout shift on remounts.

### PostMessage Protocol

Messages from iframe to parent:

| `type` | Fields | Purpose |
|--------|--------|---------|
| `action` | `intent: string`, `data?: object` | User interaction → session resume |
| `state` | `state: object` | Persist artifact UI state |
| `error` | `message: string` | Runtime error display |
| `height` | `height: number` | Content height for sizing |
| `wheel` | `deltaX, deltaY` | Forward horizontal scroll for panel navigation |

Messages from parent to iframe:

| `type` | Fields | Purpose |
|--------|--------|---------|
| `restore` | `state: object` | Restore previously saved UI state |
