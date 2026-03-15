# Phase 4: Rich Session Outputs + React Artifacts — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the agent a `render_output` tool that produces typed output blocks (markdown, HTML, tables, JSON trees, charts, files, conversations, React artifacts). Outputs render inline in the transcript or open as ephemeral panels in the TabGrid navigation system. React artifacts run sandboxed in iframes with postMessage-based action intents. Per-session file directories enable file upload and generated artifact storage.

**Architecture:** New custom tool registered via the Agent SDK's tool definition mechanism (NOT `allowedTools`, which only controls built-in SDK tools like Read, Write, Bash). The `render_output` tool schema is defined as a custom tool in the `query()` options. Tool calls are intercepted via `canUseTool` (same pattern as `AskUserQuestion`) to validate input, broadcast to SSE clients, and store as session messages with `type: "render_output"`. Frontend `OutputRenderer.tsx` switches on output type. `panel: true` outputs push ephemeral `<Panel>` children into the `<TabGrid>` navigation system. React artifacts use sandboxed iframes with Babel standalone + React UMD. Per-session file directories live under `$WORKSPACES_ROOT/{workspace}/sessions/{sessionId}/{input,output}/`.

**Tech Stack:** Hono routes, better-sqlite3, Agent SDK `canUseTool`, React 19, TanStack Query, Framer Motion, Vega-Lite, Babel standalone, shadcn/ui

---

## File Structure

```
server/
├── lib/
│   ├── session-manager.ts           — MODIFY: intercept render_output in canUseTool, add file directory helpers
│   ├── render-output.ts             — CREATE: validate render_output input, write file outputs
│   └── __tests__/
│       └── render-output.test.ts    — CREATE: validation + file output tests
├── routes/
│   └── sessions.ts                  — MODIFY: add POST /:id/files (multipart upload), GET /:id/files
src/
├── components/
│   └── layout/
│       └── TabGrid.tsx               — CREATE: TabGrid, Tab, Panel component interfaces for 2D grid navigation
├── types/
│   └── index.ts                     — MODIFY: add RenderOutput type, OutputType union
├── api/
│   └── client.ts                    — MODIFY: add uploadSessionFile(), getSessionFiles()
├── components/
│   └── session/
│       ├── SessionView.tsx           — MODIFY: track open artifact panels, render as ephemeral Panels
│       ├── SessionTranscript.tsx     — MODIFY: render render_output messages via OutputRenderer
│       ├── OutputRenderer.tsx        — CREATE: switch on output type → delegate to sub-components
│       ├── outputs/
│       │   ├── HtmlOutput.tsx        — CREATE: sandboxed iframe srcdoc
│       │   ├── TableOutput.tsx       — CREATE: sortable shadcn Table
│       │   ├── JsonTree.tsx          — CREATE: collapsible JSON tree
│       │   ├── VegaChart.tsx         — CREATE: Vega-Lite chart renderer
│       │   ├── FileCard.tsx          — CREATE: file card + download link
│       │   ├── ConversationView.tsx  — CREATE: conversation thread (reuses EmailThread patterns)
│       │   └── ArtifactFrame.tsx     — CREATE: sandboxed React artifact iframe
│       └── __tests__/
│           ├── OutputRenderer.test.tsx — CREATE: render tests for each output type
│           └── ArtifactFrame.test.tsx  — CREATE: postMessage + state persistence tests
├── lib/
│   └── artifact-sandbox.ts          — CREATE: HTML template with Babel + React UMD + shadcn stubs
├── hooks/
│   └── use-artifact-panels.ts       — CREATE: local state for ephemeral artifact panels
```

---

## Chunk 1: `render_output` Tool — Server Side

Define the tool schema, validate inputs, intercept the tool call in `canUseTool`, and store the output as a session message.

### Task 1: Output type definitions

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add RenderOutput types**

Add after the existing `SessionMessage` interface (~line 185):

```typescript
// Rich output types (render_output tool)

export type OutputType =
  | "markdown"
  | "html"
  | "table"
  | "json"
  | "chart"
  | "file"
  | "conversation"
  | "react"

export interface RenderOutputBase {
  type: OutputType
  title?: string
  panel?: boolean
}

export interface MarkdownOutput extends RenderOutputBase {
  type: "markdown"
  data: string
}

export interface HtmlOutput extends RenderOutputBase {
  type: "html"
  data: string
}

export interface TableOutput extends RenderOutputBase {
  type: "table"
  data: {
    columns: Array<{ key: string; label: string; sortable?: boolean }>
    rows: Array<Record<string, unknown>>
  }
}

export interface JsonOutput extends RenderOutputBase {
  type: "json"
  data: unknown
}

export interface ChartOutput extends RenderOutputBase {
  type: "chart"
  data: Record<string, unknown> // Vega-Lite spec
}

export interface FileOutput extends RenderOutputBase {
  type: "file"
  data: {
    filename: string
    path: string
    mimeType?: string
    size?: number
  }
}

export interface ConversationOutput extends RenderOutputBase {
  type: "conversation"
  data: {
    messages: Array<{
      from: string
      date?: string
      body: string
      bodyIsHtml?: boolean
    }>
  }
}

export interface ReactOutput extends RenderOutputBase {
  type: "react"
  data: {
    code: string
    props?: Record<string, unknown>
  }
}

export type RenderOutput =
  | MarkdownOutput
  | HtmlOutput
  | TableOutput
  | JsonOutput
  | ChartOutput
  | FileOutput
  | ConversationOutput
  | ReactOutput
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add RenderOutput type definitions for rich session outputs"
```

### Task 2: Render output validator module

**Files:**
- Create: `server/lib/render-output.ts`
- Create: `server/lib/__tests__/render-output.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/lib/__tests__/render-output.test.ts
import { describe, it, expect } from "vitest"
import { validateRenderOutput } from "../render-output.js"

describe("validateRenderOutput", () => {
  it("accepts valid markdown output", () => {
    const result = validateRenderOutput({ type: "markdown", data: "# Hello" })
    expect(result.valid).toBe(true)
  })

  it("accepts valid table output", () => {
    const result = validateRenderOutput({
      type: "table",
      data: {
        columns: [{ key: "name", label: "Name" }],
        rows: [{ name: "Alice" }],
      },
    })
    expect(result.valid).toBe(true)
  })

  it("accepts valid react output", () => {
    const result = validateRenderOutput({
      type: "react",
      data: { code: "function App() { return <div>Hello</div> }" },
    })
    expect(result.valid).toBe(true)
  })

  it("rejects unknown type", () => {
    const result = validateRenderOutput({ type: "video", data: "foo" })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("type")
  })

  it("rejects missing data", () => {
    const result = validateRenderOutput({ type: "markdown" })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("data")
  })

  it("rejects table with missing columns", () => {
    const result = validateRenderOutput({
      type: "table",
      data: { rows: [{ a: 1 }] },
    })
    expect(result.valid).toBe(false)
  })

  it("preserves optional title and panel fields", () => {
    const result = validateRenderOutput({
      type: "json",
      data: { key: "value" },
      title: "Config",
      panel: true,
    })
    expect(result.valid).toBe(true)
    expect(result.output!.title).toBe("Config")
    expect(result.output!.panel).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/render-output.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/lib/render-output.ts

const VALID_TYPES = new Set([
  "markdown", "html", "table", "json", "chart", "file", "conversation", "react",
])

export interface ValidateResult {
  valid: boolean
  error?: string
  output?: {
    type: string
    data: unknown
    title?: string
    panel?: boolean
  }
}

export function validateRenderOutput(input: Record<string, unknown>): ValidateResult {
  const { type, data, title, panel } = input

  if (!type || !VALID_TYPES.has(type as string)) {
    return { valid: false, error: `Invalid type: ${type}. Must be one of: ${[...VALID_TYPES].join(", ")}` }
  }

  if (data === undefined || data === null) {
    return { valid: false, error: "data is required" }
  }

  // Type-specific validation
  if (type === "table") {
    const tableData = data as Record<string, unknown>
    if (!Array.isArray(tableData?.columns)) {
      return { valid: false, error: "table data must include columns array" }
    }
    if (!Array.isArray(tableData?.rows)) {
      return { valid: false, error: "table data must include rows array" }
    }
  }

  if (type === "react") {
    const reactData = data as Record<string, unknown>
    if (typeof reactData?.code !== "string") {
      return { valid: false, error: "react data must include code string" }
    }
  }

  if (type === "file") {
    const fileData = data as Record<string, unknown>
    if (typeof fileData?.filename !== "string") {
      return { valid: false, error: "file data must include filename string" }
    }
  }

  if (type === "chart") {
    if (typeof data !== "object" || Array.isArray(data)) {
      return { valid: false, error: "chart data must be a Vega-Lite spec object" }
    }
  }

  if (type === "conversation") {
    const convData = data as Record<string, unknown>
    if (!Array.isArray(convData?.messages)) {
      return { valid: false, error: "conversation data must include messages array" }
    }
  }

  return {
    valid: true,
    output: {
      type: type as string,
      data,
      title: typeof title === "string" ? title : undefined,
      panel: typeof panel === "boolean" ? panel : undefined,
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/render-output.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/render-output.ts server/lib/__tests__/render-output.test.ts
git commit -m "feat: add render-output validator module"
```

### Task 3: Intercept render_output in canUseTool

**Files:**
- Modify: `server/lib/session-manager.ts`

- [ ] **Step 1: Import the validator**

Add at the top of `session-manager.ts`:

```typescript
import { validateRenderOutput } from "./render-output.js"
```

- [ ] **Step 2: Register render_output as a custom tool**

> **Important:** `allowedTools` only controls built-in Agent SDK tools (Read, Write, Bash, Grep, Glob, Edit). `render_output` is a custom tool and MUST be registered via the Agent SDK's custom tool definition mechanism, not by adding it to `allowedTools`.

Research the exact Agent SDK API for registering custom tools. The `query()` options likely support a `tools` or `customTools` parameter for defining MCP-style tools with a JSON schema. Register `render_output` with the following schema:

```typescript
// Custom tool definition for render_output
const renderOutputTool = {
  name: "render_output",
  description: "Render a rich output block (markdown, HTML, table, JSON tree, chart, file card, conversation, or React artifact) in the session UI. Use panel: true to open the output as a full side panel.",
  inputSchema: {
    type: "object",
    required: ["type", "data"],
    properties: {
      type: {
        type: "string",
        enum: ["markdown", "html", "table", "json", "chart", "file", "conversation", "react"],
        description: "The output format type",
      },
      data: {
        description: "The output data (shape depends on type)",
      },
      title: {
        type: "string",
        description: "Optional title displayed above the output",
      },
      panel: {
        type: "boolean",
        description: "If true, opens the output as a full side panel instead of inline",
      },
    },
  },
}
```

Add this tool definition to the `query()` call in both `startSession()` and `resumeSessionQuery()`. The exact parameter name depends on the Agent SDK version — check the SDK types for `tools`, `customTools`, or `mcpTools`.

- [ ] **Step 3: Intercept render_output in canUseTool**

In `makeCanUseTool()`, add a handler for `render_output` before the existing `AskUserQuestion` handler. The `canUseTool` callback intercepts the tool call to perform side effects (validation, SSE broadcast, message storage) before allowing the SDK to proceed:

```typescript
if (toolName === "render_output") {
  const sessionId = getSessionId()
  if (sessionId) {
    const validation = validateRenderOutput(input as Record<string, unknown>)
    if (validation.valid && validation.output) {
      // Store as a session message and broadcast to SSE clients
      const messages = getSessionMessages(sessionId)
      const nextSequence = messages.length
      const outputMessage = {
        type: "render_output",
        output: validation.output,
      }
      appendSessionMessage(sessionId, nextSequence, "render_output", outputMessage)
      broadcastToSession(sessionId, { sequence: nextSequence, message: outputMessage })
    }
  }
  // Always allow — the tool call itself is a no-op; the side effect is the message
  return { behavior: "allow" }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/session-manager.ts
git commit -m "feat: intercept render_output tool in canUseTool and store as session message"
```

---

## Chunk 2: OutputRenderer — Frontend Components

Build the `OutputRenderer.tsx` dispatcher and each output-type component.

### Task 4: OutputRenderer dispatcher

**Files:**
- Create: `src/components/session/OutputRenderer.tsx`

- [ ] **Step 1: Create OutputRenderer**

```tsx
// src/components/session/OutputRenderer.tsx
import { lazy, Suspense } from "react"
import { Loader2 } from "lucide-react"
import type { RenderOutput } from "@/types"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"

const HtmlOutput = lazy(() => import("./outputs/HtmlOutput"))
const TableOutput = lazy(() => import("./outputs/TableOutput"))
const JsonTree = lazy(() => import("./outputs/JsonTree"))
const VegaChart = lazy(() => import("./outputs/VegaChart"))
const FileCard = lazy(() => import("./outputs/FileCard"))
const ConversationView = lazy(() => import("./outputs/ConversationView"))
const ArtifactFrame = lazy(() => import("./outputs/ArtifactFrame"))

interface OutputRendererProps {
  output: RenderOutput
  sessionId: string
  sequence: number
  onOpenPanel?: (output: RenderOutput, sequence: number) => void
}

function LazyFallback() {
  return (
    <div className="flex items-center justify-center p-4">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  )
}

export function OutputRenderer({ output, sessionId, sequence, onOpenPanel }: OutputRendererProps) {
  // If panel: true, render a compact card that opens the full panel on click
  if (output.panel && onOpenPanel) {
    return (
      <button
        type="button"
        onClick={() => onOpenPanel(output, sequence)}
        className="w-full text-left rounded-lg border p-3 bg-card hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">{output.type}</span>
          {output.title && <span className="text-sm font-medium truncate">{output.title}</span>}
          <span className="ml-auto text-xs text-muted-foreground">Open panel</span>
        </div>
      </button>
    )
  }

  return <OutputContent output={output} sessionId={sessionId} sequence={sequence} />
}

export function OutputContent({
  output,
  sessionId,
  sequence,
}: {
  output: RenderOutput
  sessionId: string
  sequence: number
}) {
  const wrapper = (children: React.ReactNode) => (
    <div className="rounded-lg border p-3 bg-card">
      {output.title && (
        <h3 className="text-sm font-medium mb-2">{output.title}</h3>
      )}
      {children}
    </div>
  )

  switch (output.type) {
    case "markdown":
      return wrapper(
        <div className="prose prose-sm max-w-none dark:prose-invert overflow-x-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {output.data}
          </ReactMarkdown>
        </div>
      )

    case "html":
      return wrapper(
        <Suspense fallback={<LazyFallback />}>
          <HtmlOutput html={output.data} />
        </Suspense>
      )

    case "table":
      return wrapper(
        <Suspense fallback={<LazyFallback />}>
          <TableOutput columns={output.data.columns} rows={output.data.rows} />
        </Suspense>
      )

    case "json":
      return wrapper(
        <Suspense fallback={<LazyFallback />}>
          <JsonTree data={output.data} />
        </Suspense>
      )

    case "chart":
      return wrapper(
        <Suspense fallback={<LazyFallback />}>
          <VegaChart spec={output.data} />
        </Suspense>
      )

    case "file":
      return wrapper(
        <Suspense fallback={<LazyFallback />}>
          <FileCard file={output.data} sessionId={sessionId} />
        </Suspense>
      )

    case "conversation":
      return wrapper(
        <Suspense fallback={<LazyFallback />}>
          <ConversationView messages={output.data.messages} />
        </Suspense>
      )

    case "react":
      return wrapper(
        <Suspense fallback={<LazyFallback />}>
          <ArtifactFrame
            code={output.data.code}
            props={output.data.props}
            sessionId={sessionId}
            sequence={sequence}
          />
        </Suspense>
      )

    default:
      return wrapper(
        <pre className="text-xs text-muted-foreground overflow-x-auto">
          {JSON.stringify(output, null, 2)}
        </pre>
      )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/session/OutputRenderer.tsx
git commit -m "feat: add OutputRenderer dispatcher component"
```

### Task 5: HtmlOutput component

**Files:**
- Create: `src/components/session/outputs/HtmlOutput.tsx`

- [ ] **Step 1: Create HtmlOutput**

Uses a sandboxed iframe with `sandbox="allow-scripts"` (no `allow-same-origin`). Includes a ResizeObserver script that reports content height via postMessage so the iframe auto-sizes.

```tsx
// src/components/session/outputs/HtmlOutput.tsx
import { useRef, useEffect, useState } from "react"

interface HtmlOutputProps {
  html: string
}

export default function HtmlOutput({ html }: HtmlOutputProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    function handleMessage(e: MessageEvent) {
      if (e.source === iframe?.contentWindow && e.data?.type === "resize") {
        setHeight(Math.min(e.data.height + 16, 600))
      }
    }
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  const wrappedHtml = [
    "<!DOCTYPE html><html><head>",
    "<style>body { margin: 0; padding: 8px; font-family: system-ui, sans-serif; font-size: 14px; }</style>",
    "</head><body>",
    html,
    "<script>new ResizeObserver(function() { parent.postMessage({ type: 'resize', height: document.body.scrollHeight }, '*') }).observe(document.body)</script>",
    "</body></html>",
  ].join("\n")

  return (
    <iframe
      ref={iframeRef}
      srcDoc={wrappedHtml}
      sandbox="allow-scripts"
      className="w-full border-0 rounded"
      style={{ height }}
      title="HTML output"
    />
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/session/outputs/HtmlOutput.tsx
git commit -m "feat: add HtmlOutput sandboxed iframe component"
```

### Task 6: TableOutput component

**Files:**
- Create: `src/components/session/outputs/TableOutput.tsx`

- [ ] **Step 1: Create TableOutput**

```tsx
// src/components/session/outputs/TableOutput.tsx
import { useState, useMemo } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hammies/frontend/components/ui"
import { ArrowUpDown } from "lucide-react"

interface Column {
  key: string
  label: string
  sortable?: boolean
}

interface TableOutputProps {
  columns: Column[]
  rows: Array<Record<string, unknown>>
}

export default function TableOutput({ columns, rows }: TableOutputProps) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av
      }
      const cmp = String(av).localeCompare(String(bv))
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  return (
    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key}>
                {col.sortable !== false ? (
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                ) : (
                  col.label
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col.key} className="text-sm">
                  {formatCell(row[col.key])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/session/outputs/TableOutput.tsx
git commit -m "feat: add TableOutput sortable table component"
```

### Task 7: JsonTree component

**Files:**
- Create: `src/components/session/outputs/JsonTree.tsx`

- [ ] **Step 1: Create JsonTree**

```tsx
// src/components/session/outputs/JsonTree.tsx
import { useState, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"

interface JsonTreeProps {
  data: unknown
  defaultExpanded?: number // depth to auto-expand, default 2
}

export default function JsonTree({ data, defaultExpanded = 2 }: JsonTreeProps) {
  return (
    <div className="font-mono text-xs overflow-x-auto">
      <JsonNode value={data} depth={0} defaultExpanded={defaultExpanded} />
    </div>
  )
}

function JsonNode({
  label,
  value,
  depth,
  defaultExpanded,
}: {
  label?: string
  value: unknown
  depth: number
  defaultExpanded: number
}) {
  const [expanded, setExpanded] = useState(depth < defaultExpanded)

  if (value === null) return <JsonLeaf label={label} value="null" color="text-muted-foreground" />
  if (typeof value === "boolean") return <JsonLeaf label={label} value={String(value)} color="text-chart-2" />
  if (typeof value === "number") return <JsonLeaf label={label} value={String(value)} color="text-chart-1" />
  if (typeof value === "string") return <JsonLeaf label={label} value={JSON.stringify(value)} color="text-chart-4" />

  if (Array.isArray(value)) {
    if (value.length === 0) return <JsonLeaf label={label} value="[]" color="text-muted-foreground" />
    return (
      <JsonBranch
        label={label}
        preview={`Array(${value.length})`}
        expanded={expanded}
        onToggle={() => setExpanded((e) => !e)}
      >
        {value.map((item, i) => (
          <JsonNode key={i} label={String(i)} value={item} depth={depth + 1} defaultExpanded={defaultExpanded} />
        ))}
      </JsonBranch>
    )
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <JsonLeaf label={label} value="{}" color="text-muted-foreground" />
    return (
      <JsonBranch
        label={label}
        preview={`{${entries.length}}`}
        expanded={expanded}
        onToggle={() => setExpanded((e) => !e)}
      >
        {entries.map(([k, v]) => (
          <JsonNode key={k} label={k} value={v} depth={depth + 1} defaultExpanded={defaultExpanded} />
        ))}
      </JsonBranch>
    )
  }

  return <JsonLeaf label={label} value={String(value)} color="text-muted-foreground" />
}

function JsonLeaf({ label, value, color }: { label?: string; value: string; color: string }) {
  return (
    <div className="flex gap-1 py-0.5 pl-4">
      {label != null && <span className="text-foreground/70">{label}:</span>}
      <span className={color}>{value}</span>
    </div>
  )
}

function JsonBranch({
  label,
  preview,
  expanded,
  onToggle,
  children,
}: {
  label?: string
  preview: string
  expanded: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 py-0.5 pl-1 hover:bg-accent/50 rounded w-full text-left"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
        {label != null && <span className="text-foreground/70">{label}:</span>}
        {!expanded && <span className="text-muted-foreground">{preview}</span>}
      </button>
      {expanded && <div className="pl-3 border-l border-border/50 ml-2">{children}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/session/outputs/JsonTree.tsx
git commit -m "feat: add JsonTree collapsible JSON viewer component"
```

### Task 8: VegaChart component

**Files:**
- Create: `src/components/session/outputs/VegaChart.tsx`

- [ ] **Step 1: Install vega-lite + vega-embed**

Run: `cd packages/inbox && npm install vega vega-lite vega-embed`

> **Bundle size note:** The `vega` + `vega-lite` + `vega-embed` bundle is ~2MB. This is acceptable because `VegaChart` is already loaded via `React.lazy()` (dynamic import) in `OutputRenderer.tsx`, so it only loads when a chart output is actually rendered. If bundle size becomes a concern, consider loading Vega from a CDN at runtime instead of bundling it (similar to the Babel/React UMD approach used in `artifact-sandbox.ts`).

- [ ] **Step 2: Create VegaChart**

```tsx
// src/components/session/outputs/VegaChart.tsx
import { useRef, useEffect } from "react"

interface VegaChartProps {
  spec: Record<string, unknown>
}

export default function VegaChart({ spec }: VegaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    async function render() {
      const vegaEmbed = (await import("vega-embed")).default
      if (cancelled || !containerRef.current) return

      const fullSpec = {
        $schema: "https://vega.github.io/schema/vega-lite/v5.json",
        ...spec,
        width: "container",
        height: 300,
        config: {
          background: "transparent",
          axis: { labelColor: "#888", titleColor: "#888", gridColor: "#333" },
          legend: { labelColor: "#888", titleColor: "#888" },
        },
      }

      try {
        await vegaEmbed(containerRef.current, fullSpec as any, {
          actions: { export: true, source: false, compiled: false, editor: false },
          theme: "dark",
        })
      } catch (err) {
        console.error("Vega render error:", err)
        if (containerRef.current) {
          containerRef.current.textContent = String(err)
        }
      }
    }

    render()
    return () => { cancelled = true }
  }, [spec])

  return <div ref={containerRef} className="w-full min-h-[200px]" />
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/session/outputs/VegaChart.tsx package.json package-lock.json
git commit -m "feat: add VegaChart Vega-Lite renderer component"
```

### Task 9: FileCard component

**Files:**
- Create: `src/components/session/outputs/FileCard.tsx`

- [ ] **Step 1: Create FileCard**

```tsx
// src/components/session/outputs/FileCard.tsx
import { File, Download } from "lucide-react"
import { Button } from "@hammies/frontend/components/ui"

interface FileCardProps {
  file: {
    filename: string
    path: string
    mimeType?: string
    size?: number
  }
  sessionId: string
}

export default function FileCard({ file, sessionId }: FileCardProps) {
  const downloadUrl = `/api/sessions/${sessionId}/files/${encodeURIComponent(file.filename)}`

  function formatSize(bytes?: number): string {
    if (!bytes) return ""
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="flex items-center gap-3 p-2 rounded-md bg-muted/50">
      <File className="h-8 w-8 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{file.filename}</p>
        <p className="text-xs text-muted-foreground">
          {file.mimeType && <span>{file.mimeType}</span>}
          {file.size != null && <span> {formatSize(file.size)}</span>}
        </p>
      </div>
      <Button variant="ghost" size="sm" asChild>
        <a href={downloadUrl} download={file.filename}>
          <Download className="h-4 w-4" />
        </a>
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/session/outputs/FileCard.tsx
git commit -m "feat: add FileCard download component"
```

### Task 10: ConversationView component

**Files:**
- Create: `src/components/session/outputs/ConversationView.tsx`

- [ ] **Step 1: Create ConversationView**

```tsx
// src/components/session/outputs/ConversationView.tsx

interface ConversationMessage {
  from: string
  date?: string
  body: string
  bodyIsHtml?: boolean
}

interface ConversationViewProps {
  messages: ConversationMessage[]
}

export default function ConversationView({ messages }: ConversationViewProps) {
  return (
    <div className="space-y-3">
      {messages.map((msg, i) => (
        <div key={i} className="border-l-2 border-border pl-3">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-sm font-medium">{msg.from}</span>
            {msg.date && (
              <span className="text-xs text-muted-foreground">{msg.date}</span>
            )}
          </div>
          {msg.bodyIsHtml ? (
            <iframe
              srcDoc={msg.body}
              sandbox=""
              className="w-full border-0 min-h-[60px] max-h-[300px]"
              title={`Message from ${msg.from}`}
            />
          ) : (
            <div className="text-sm whitespace-pre-wrap break-words">{msg.body}</div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/session/outputs/ConversationView.tsx
git commit -m "feat: add ConversationView thread component"
```

### Task 11: Wire OutputRenderer into SessionTranscript

**Files:**
- Modify: `src/components/session/SessionTranscript.tsx`

- [ ] **Step 1: Import OutputRenderer**

Add import at the top:

```typescript
import { OutputRenderer } from "./OutputRenderer"
import type { RenderOutput } from "@/types"
```

- [ ] **Step 2: Add render_output message type handler**

In `TranscriptEntry` (the `memo` component starting at ~line 200), add a new case before the final `return null` (~line 344). After the `msg.type === "plan"` block and before the `msg.type === "tool_result"` check:

```tsx
if (msg.type === "render_output" && msg.output) {
  if (!visibility.messages) return null
  return (
    <OutputRenderer
      output={msg.output as RenderOutput}
      sessionId={sessionId ?? ""}
      sequence={message.sequence}
    />
  )
}
```

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/session/SessionTranscript.tsx
git commit -m "feat: render render_output messages in session transcript"
```

---

## Chunk 3: TabGrid Navigation System + Ephemeral Artifact Panels

> **Navigation Architecture (2D Grid):** The app uses a 2D grid navigation model:
> - **Sidebar items = Tabs** (arranged vertically)
> - **Each Tab has a stack of Panels** (arranged horizontally)
> - **Tab selection:** scrolls the grid vertically to bring the selected tab row into view
> - **Panel addition:** scrolls horizontally within the tab to bring the new (rightmost) panel into view
> - **Scroll state persisted per tab:** returning to a tab restores scroll position and panel state
> - **List/Detail pattern:** list panels have accompanying detail panels; selecting an item scrolls to reveal detail
>
> Phase 4 defines the `TabGrid`, `Tab`, `Panel` component interfaces and implements ephemeral panel support for artifacts. The existing PanelStack migration to this system is a separate refactor task. Phase 5 then uses the same `Tab`/`Panel` API for source plugin views.

### Task 12: TabGrid, Tab, Panel component interfaces

**Files:**
- Create: `src/components/layout/TabGrid.tsx`

- [ ] **Step 1: Define the TabGrid API**

The API is declarative React. The parent (`TabGrid`) handles layout, animation, scroll behavior, state persistence, and push/pop semantics. Children are `Tab` and `Panel` components.

```tsx
// src/components/layout/TabGrid.tsx
import { createContext, useContext, useRef, useEffect, useCallback, useState, type ReactNode } from "react"

// --- Public API types ---

interface TabGridProps {
  activeTab: string
  onTabChange: (tabId: string) => void
  children: ReactNode
}

interface TabProps {
  id: string
  children: ReactNode
}

interface PanelProps {
  id: string
  children: ReactNode
  /** Ephemeral panels (e.g. artifact outputs) can be closed */
  ephemeral?: boolean
  onClose?: () => void
}

// --- Context for child components ---

interface TabGridContextValue {
  activeTab: string
  scrollPositions: Map<string, number>
  saveScrollPosition: (tabId: string, position: number) => void
}

const TabGridContext = createContext<TabGridContextValue | null>(null)

// --- Components ---

/**
 * TabGrid: 2D grid layout container.
 *
 * Layout: CSS grid or absolute positioning.
 * Animation: Framer Motion or CSS transitions on tab/panel changes.
 * Scroll: scrollIntoView on tab/panel changes.
 * State: scroll positions persisted per tab.
 * Push/pop: adding/removing Panel children updates the horizontal stack.
 */
export function TabGrid({ activeTab, onTabChange, children }: TabGridProps) {
  const [scrollPositions] = useState(() => new Map<string, number>())

  const saveScrollPosition = useCallback(
    (tabId: string, position: number) => {
      scrollPositions.set(tabId, position)
    },
    [scrollPositions],
  )

  return (
    <TabGridContext.Provider value={{ activeTab, scrollPositions, saveScrollPosition }}>
      <div className="flex flex-col h-full w-full overflow-hidden">
        {children}
      </div>
    </TabGridContext.Provider>
  )
}

/**
 * Tab: a horizontal row of Panels within the grid.
 * Only the active tab's row is visible. On tab switch, vertical scroll
 * brings this row into view and restores its horizontal scroll position.
 */
export function Tab({ id, children }: TabProps) {
  const ctx = useContext(TabGridContext)
  const rowRef = useRef<HTMLDivElement>(null)
  const isActive = ctx?.activeTab === id

  // Restore scroll position when tab becomes active
  useEffect(() => {
    if (isActive && rowRef.current) {
      const saved = ctx?.scrollPositions.get(id)
      if (saved != null) {
        rowRef.current.scrollLeft = saved
      }
    }
  }, [isActive, id, ctx])

  // Save scroll position on scroll
  const handleScroll = useCallback(() => {
    if (rowRef.current && ctx) {
      ctx.saveScrollPosition(id, rowRef.current.scrollLeft)
    }
  }, [id, ctx])

  if (!isActive) return null

  return (
    <div
      ref={rowRef}
      className="flex flex-row h-full w-full overflow-x-auto"
      onScroll={handleScroll}
    >
      {children}
    </div>
  )
}

/**
 * Panel: a single panel within a Tab's horizontal stack.
 * Ephemeral panels (artifacts) include a close button and can be removed.
 * New panels scroll into view automatically.
 */
export function Panel({ id, children, ephemeral, onClose }: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Scroll new panels into view
  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" })
  }, [])

  return (
    <div
      ref={panelRef}
      className="shrink-0 h-full overflow-hidden flex flex-col"
      data-panel-id={id}
      data-ephemeral={ephemeral || undefined}
    >
      {ephemeral && onClose && (
        <div className="flex items-center justify-end px-2 py-1 border-b">
          <button
            type="button"
            className="p-1 rounded-md hover:bg-accent text-muted-foreground text-xs"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

export function useTabGrid() {
  const ctx = useContext(TabGridContext)
  if (!ctx) throw new Error("useTabGrid must be used within a TabGrid")
  return ctx
}
```

> **Note:** This is the interface definition. The full implementation (Framer Motion animations, CSS grid positioning, production scroll behavior) will be refined during the PanelStack migration refactor. Phase 4 only needs the ephemeral panel support for artifacts.

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/TabGrid.tsx
git commit -m "feat: define TabGrid, Tab, Panel component interfaces for 2D grid navigation"
```

### Task 13: Artifact panel state hook

**Files:**
- Create: `src/hooks/use-artifact-panels.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/hooks/use-artifact-panels.ts
import { useState, useCallback } from "react"
import type { RenderOutput } from "@/types"

export interface ArtifactPanel {
  id: string // `${sessionId}:${sequence}`
  output: RenderOutput
  sessionId: string
  sequence: number
}

export function useArtifactPanels() {
  const [panels, setPanels] = useState<ArtifactPanel[]>([])

  const openPanel = useCallback((sessionId: string, output: RenderOutput, sequence: number) => {
    const id = `${sessionId}:${sequence}`
    setPanels((prev) => {
      if (prev.some((p) => p.id === id)) return prev
      return [...prev, { id, output, sessionId, sequence }]
    })
  }, [])

  const closePanel = useCallback((id: string) => {
    setPanels((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const closeAllForSession = useCallback((sessionId: string) => {
    setPanels((prev) => prev.filter((p) => p.sessionId !== sessionId))
  }, [])

  return { panels, openPanel, closePanel, closeAllForSession }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-artifact-panels.ts
git commit -m "feat: add useArtifactPanels hook for ephemeral panel state"
```

### Task 14: Wire artifact panels into SessionView using TabGrid API

**Files:**
- Modify: `src/components/session/SessionView.tsx`
- Modify: `src/components/session/SessionTranscript.tsx`

> **Design note:** Artifact panels render as ephemeral `<Panel>` children within the sessions `<Tab>`, following the TabGrid API. The `OutputRenderer`'s `onOpenPanel` callback pushes new panels. This uses the same pattern that Phase 5 source plugin views will use — no PanelStack internals are modified.

- [ ] **Step 1: Add artifact panel state to SessionView**

In `SessionView.tsx`, add imports:

```typescript
import { useArtifactPanels } from "@/hooks/use-artifact-panels"
import { Panel } from "@/components/layout/TabGrid"
import { OutputContent } from "./OutputRenderer"
import type { RenderOutput } from "@/types"
```

Inside the `SessionView` component, add the hook:

```typescript
const { panels: artifactPanels, openPanel, closePanel } = useArtifactPanels()

const handleOpenPanel = useCallback(
  (output: RenderOutput, sequence: number) => openPanel(sessionId, output, sequence),
  [openPanel, sessionId],
)
```

- [ ] **Step 2: Pass onOpenPanel to SessionTranscript**

Pass `handleOpenPanel` as a prop to `SessionTranscript`:

```tsx
<SessionTranscript
  messages={allMessages}
  isStreaming={isRunning}
  status={status}
  messageCount={data.session.messageCount}
  isLive={stream.connected}
  visibility={visibility}
  sessionId={sessionId}
  onOpenPanel={handleOpenPanel}
/>
```

- [ ] **Step 3: Render ephemeral artifact panels using the Panel component**

After the main session content, render artifact panels as sibling `<Panel>` components. These will be wrapped in a `<Tab>` at the app layout level (or temporarily in a flex row until the full TabGrid migration):

```tsx
{/* Ephemeral artifact panels — uses TabGrid Panel API */}
{artifactPanels.map((panel) => (
  <Panel
    key={panel.id}
    id={panel.id}
    ephemeral
    onClose={() => closePanel(panel.id)}
  >
    <div className="p-3">
      {panel.output.title && (
        <h3 className="text-sm font-medium mb-2 truncate">
          {panel.output.title || `${panel.output.type} output`}
        </h3>
      )}
      <OutputContent
        output={panel.output}
        sessionId={panel.sessionId}
        sequence={panel.sequence}
      />
    </div>
  </Panel>
))}
```

- [ ] **Step 4: Wire onOpenPanel into SessionTranscript**

In `SessionTranscript.tsx`, accept `onOpenPanel` as a prop and pass it to `OutputRenderer`:

```tsx
// In SessionTranscript props:
onOpenPanel?: (output: RenderOutput, sequence: number) => void

// In the render_output handler:
if (msg.type === "render_output" && msg.output) {
  if (!visibility.messages) return null
  return (
    <OutputRenderer
      output={msg.output as RenderOutput}
      sessionId={sessionId ?? ""}
      sequence={message.sequence}
      onOpenPanel={onOpenPanel}
    />
  )
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/session/SessionView.tsx src/components/session/SessionTranscript.tsx
git commit -m "feat: render artifact panels as ephemeral Panel components using TabGrid API"
```

> **Follow-up (separate refactor):** Migrate the existing PanelStack to use `TabGrid`/`Tab`/`Panel` throughout the app. This is intentionally deferred — Phase 4 only adds the ephemeral panel support needed for artifacts. Phase 5 source plugin views will use the same `Tab`/`Panel` API.

---

## Chunk 4: React Artifacts (ArtifactFrame)

Sandboxed React component rendering with Babel standalone compilation, postMessage action intents, and local state persistence.

### Task 15: Artifact sandbox HTML template

**Files:**
- Create: `src/lib/artifact-sandbox.ts`

- [ ] **Step 1: Create the sandbox template**

The iframe runs with `sandbox="allow-scripts"` (NO `allow-same-origin`), so it cannot access the parent's cookies, localStorage, or DOM.

Communication is via postMessage only:
- Parent to iframe: `{ type: "props", props: {...} }` and `{ type: "state", state: {...} }`
- Iframe to parent: `{ type: "action", action: string, payload: {...} }`, `{ type: "state_save", state: {...} }`, `{ type: "resize", height: number }`, `{ type: "error", message: string }`

```typescript
// src/lib/artifact-sandbox.ts

const BABEL_CDN = "https://unpkg.com/@babel/standalone@7/babel.min.js"
const REACT_CDN = "https://unpkg.com/react@19/umd/react.production.min.js"
const REACT_DOM_CDN = "https://unpkg.com/react-dom@19/umd/react-dom.production.min.js"

export function buildArtifactHtml(
  code: string,
  initialProps?: Record<string, unknown>,
  initialState?: unknown,
): string {
  const propsJson = JSON.stringify(initialProps ?? {})
  const stateJson = JSON.stringify(initialState ?? null)

  return [
    '<!DOCTYPE html><html><head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<style>',
    '  * { box-sizing: border-box; margin: 0; padding: 0; }',
    '  body { font-family: system-ui, -apple-system, sans-serif; padding: 16px; color: #e4e4e7; background: transparent; }',
    '  button { cursor: pointer; padding: 8px 16px; border-radius: 6px; border: 1px solid #3f3f46; background: #27272a; color: #e4e4e7; font-size: 14px; }',
    '  button:hover { background: #3f3f46; }',
    '  input, textarea, select { padding: 8px; border-radius: 6px; border: 1px solid #3f3f46; background: #18181b; color: #e4e4e7; font-size: 14px; width: 100%; }',
    '  table { width: 100%; border-collapse: collapse; }',
    '  th, td { padding: 8px; border: 1px solid #3f3f46; text-align: left; font-size: 14px; }',
    '  th { background: #27272a; }',
    '  .card { border: 1px solid #3f3f46; border-radius: 8px; padding: 16px; background: #18181b; }',
    '  .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 12px; background: #3f3f46; }',
    '</style>',
    `<script src="${REACT_CDN}"><` + '/script>',
    `<script src="${REACT_DOM_CDN}"><` + '/script>',
    `<script src="${BABEL_CDN}"><` + '/script>',
    '</head><body>',
    '<div id="root"></div>',
    '<script>',
    `var _artifactState = ${stateJson};`,
    `var _artifactProps = ${propsJson};`,
    'var _stateListeners = [];',
    '',
    'function useArtifactState(initialValue) {',
    '  var ref = React.useRef({ state: _artifactState !== null ? _artifactState : initialValue });',
    '  var _s = React.useState(ref.current.state);',
    '  var state = _s[0]; var setState = _s[1];',
    '  React.useEffect(function() {',
    '    var listener = function(s) { ref.current.state = s; setState(s); };',
    '    _stateListeners.push(listener);',
    '    return function() { _stateListeners = _stateListeners.filter(function(l) { return l !== listener; }); };',
    '  }, []);',
    '  var setAndSave = React.useCallback(function(newState) {',
    '    var resolved = typeof newState === "function" ? newState(ref.current.state) : newState;',
    '    _artifactState = resolved;',
    '    ref.current.state = resolved;',
    '    setState(resolved);',
    '    parent.postMessage({ type: "state_save", state: resolved }, "*");',
    '  }, []);',
    '  return [state, setAndSave];',
    '}',
    '',
    'function useArtifactAction() {',
    '  return React.useCallback(function(action, payload) {',
    '    parent.postMessage({ type: "action", action: action, payload: payload }, "*");',
    '  }, []);',
    '}',
    '',
    'window.addEventListener("message", function(e) {',
    '  if (e.data && e.data.type === "props") { _artifactProps = e.data.props; renderApp(); }',
    '  if (e.data && e.data.type === "state") { _artifactState = e.data.state; _stateListeners.forEach(function(l) { l(e.data.state); }); }',
    '});',
    '',
    'new ResizeObserver(function() {',
    '  parent.postMessage({ type: "resize", height: document.body.scrollHeight }, "*");',
    '}).observe(document.body);',
    '<' + '/script>',
    '<script type="text/babel" data-type="module">',
    'try {',
    code,
    '',
    '  function renderApp() {',
    '    var root = ReactDOM.createRoot(document.getElementById("root"));',
    '    root.render(React.createElement(typeof App !== "undefined" ? App : function() { return React.createElement("div", null, "No App component exported"); }, _artifactProps));',
    '  }',
    '  renderApp();',
    '} catch (err) {',
    '  parent.postMessage({ type: "error", message: err.message }, "*");',
    '  document.getElementById("root").textContent = err.message;',
    '}',
    '<' + '/script>',
    '</body></html>',
  ].join('\n')
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/artifact-sandbox.ts
git commit -m "feat: add artifact sandbox HTML template with React UMD + Babel"
```

### Task 16: ArtifactFrame component

**Files:**
- Create: `src/components/session/outputs/ArtifactFrame.tsx`

- [ ] **Step 1: Create ArtifactFrame**

```tsx
// src/components/session/outputs/ArtifactFrame.tsx
import { useRef, useEffect, useState, useCallback } from "react"
import { usePreference } from "@/hooks/use-preferences"
import { buildArtifactHtml } from "@/lib/artifact-sandbox"

interface ArtifactFrameProps {
  code: string
  props?: Record<string, unknown>
  sessionId: string
  sequence: number
}

export default function ArtifactFrame({ code, props, sessionId, sequence }: ArtifactFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(300)
  const [error, setError] = useState<string | null>(null)

  // State persisted via user_preferences table (PK: user_email + key).
  // usePreference() handles auth transparently — the server resolves user_email
  // from the session cookie; the frontend doesn't need to know the email.
  const stateKey = `artifact:${sessionId}:${sequence}`
  const [savedState, setSavedState] = usePreference<unknown>(stateKey, null)

  const handleMessage = useCallback(
    (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return

      switch (e.data?.type) {
        case "resize":
          setHeight(Math.min(Math.max(e.data.height + 16, 100), 800))
          break
        case "state_save":
          setSavedState(e.data.state)
          break
        case "action":
          // Action intents from artifact — log for now, future: post as user message
          console.log("Artifact action:", e.data.action, e.data.payload)
          break
        case "error":
          setError(e.data.message)
          break
      }
    },
    [setSavedState],
  )

  useEffect(() => {
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [handleMessage])

  useEffect(() => {
    if (props && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: "props", props }, "*")
    }
  }, [props])

  const html = buildArtifactHtml(code, props, savedState)

  return (
    <div>
      {error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1 mb-2">
          {error}
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={html}
        sandbox="allow-scripts"
        className="w-full border-0 rounded"
        style={{ height }}
        title="React artifact"
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/session/outputs/ArtifactFrame.tsx
git commit -m "feat: add ArtifactFrame sandboxed React artifact component"
```

### Task 17: ArtifactFrame tests

**Files:**
- Create: `src/components/session/__tests__/ArtifactFrame.test.tsx`

- [ ] **Step 1: Write tests**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { buildArtifactHtml } from "@/lib/artifact-sandbox"

describe("buildArtifactHtml", () => {
  it("includes the user code in a babel script tag", () => {
    const html = buildArtifactHtml("function App() { return <div>Hello</div> }")
    expect(html).toContain("function App()")
    expect(html).toContain("text/babel")
  })

  it("includes React and ReactDOM CDN scripts", () => {
    const html = buildArtifactHtml("function App() { return null }")
    expect(html).toContain("react.production.min.js")
    expect(html).toContain("react-dom")
  })

  it("serializes initial props into the template", () => {
    const html = buildArtifactHtml("function App() { return null }", { name: "test" })
    expect(html).toContain('"name":"test"')
  })

  it("serializes initial state into the template", () => {
    const html = buildArtifactHtml("function App() { return null }", undefined, { count: 5 })
    expect(html).toContain('"count":5')
  })

  it("includes shadcn-like CSS stubs", () => {
    const html = buildArtifactHtml("function App() { return null }")
    expect(html).toContain(".card")
    expect(html).toContain(".badge")
  })

  it("includes useArtifactState helper", () => {
    const html = buildArtifactHtml("function App() { return null }")
    expect(html).toContain("useArtifactState")
  })

  it("includes useArtifactAction helper", () => {
    const html = buildArtifactHtml("function App() { return null }")
    expect(html).toContain("useArtifactAction")
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npx vitest run src/components/session/__tests__/ArtifactFrame.test.tsx`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/session/__tests__/ArtifactFrame.test.tsx
git commit -m "test: add ArtifactFrame and sandbox template tests"
```

---

## Chunk 5: Per-Session File Directories

Set up per-session file directories for user uploads (`input/`) and generated artifacts (`output/`). Add multipart upload route and file serving route.

### Task 18: Session file directory helpers

**Files:**
- Modify: `server/lib/render-output.ts`

- [ ] **Step 1: Add file directory helpers**

Append to `server/lib/render-output.ts`:

```typescript
import { join } from "path"
import { mkdirSync, existsSync, readdirSync, statSync } from "fs"

/**
 * Get the per-session directory path.
 * Convention: {workspacePath}/sessions/{sessionId}/
 */
export function getSessionDir(workspacePath: string, sessionId: string): string {
  return join(workspacePath, "sessions", sessionId)
}

export function getSessionInputDir(workspacePath: string, sessionId: string): string {
  return join(getSessionDir(workspacePath, sessionId), "input")
}

export function getSessionOutputDir(workspacePath: string, sessionId: string): string {
  return join(getSessionDir(workspacePath, sessionId), "output")
}

/**
 * Ensure session directories exist.
 */
export function ensureSessionDirs(workspacePath: string, sessionId: string): void {
  const inputDir = getSessionInputDir(workspacePath, sessionId)
  const outputDir = getSessionOutputDir(workspacePath, sessionId)
  mkdirSync(inputDir, { recursive: true })
  mkdirSync(outputDir, { recursive: true })
}

/**
 * List files in a session directory (input or output).
 */
export function listSessionFiles(
  workspacePath: string,
  sessionId: string,
  subdir: "input" | "output",
): Array<{ filename: string; size: number; path: string }> {
  const dir = join(getSessionDir(workspacePath, sessionId), subdir)
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((f) => !f.startsWith("."))
    .map((filename) => {
      const fullPath = join(dir, filename)
      const stat = statSync(fullPath)
      return { filename, size: stat.size, path: fullPath }
    })
}
```

- [ ] **Step 2: Commit**

```bash
git add server/lib/render-output.ts
git commit -m "feat: add per-session file directory helpers"
```

### Task 19: File directory tests

**Files:**
- Modify: `server/lib/__tests__/render-output.test.ts`

- [ ] **Step 1: Add file directory tests**

Append to the existing test file:

```typescript
import { getSessionDir, getSessionInputDir, getSessionOutputDir, ensureSessionDirs, listSessionFiles } from "../render-output.js"
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("session file directories", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "render-output-test-"))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("computes correct session directory paths", () => {
    expect(getSessionDir("/workspace", "abc")).toBe("/workspace/sessions/abc")
    expect(getSessionInputDir("/workspace", "abc")).toBe("/workspace/sessions/abc/input")
    expect(getSessionOutputDir("/workspace", "abc")).toBe("/workspace/sessions/abc/output")
  })

  it("creates input and output directories", () => {
    ensureSessionDirs(tmpDir, "session-1")
    expect(existsSync(join(tmpDir, "sessions", "session-1", "input"))).toBe(true)
    expect(existsSync(join(tmpDir, "sessions", "session-1", "output"))).toBe(true)
  })

  it("lists files in a session directory", () => {
    ensureSessionDirs(tmpDir, "session-2")
    const inputDir = getSessionInputDir(tmpDir, "session-2")
    writeFileSync(join(inputDir, "doc.pdf"), "fake pdf content")
    writeFileSync(join(inputDir, "data.csv"), "a,b\n1,2")

    const files = listSessionFiles(tmpDir, "session-2", "input")
    expect(files).toHaveLength(2)
    expect(files.map((f) => f.filename).sort()).toEqual(["data.csv", "doc.pdf"])
  })

  it("returns empty array for non-existent directory", () => {
    const files = listSessionFiles(tmpDir, "nonexistent", "input")
    expect(files).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npx vitest run server/lib/__tests__/render-output.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/lib/__tests__/render-output.test.ts
git commit -m "test: add per-session file directory tests"
```

### Task 20: File upload and serving routes

**Files:**
- Modify: `server/routes/sessions.ts`

- [ ] **Step 1: Add file routes**

Add imports at the top of `sessions.ts`:

```typescript
import { ensureSessionDirs, getSessionInputDir, getSessionOutputDir, listSessionFiles } from "../lib/render-output.js"
import { existsSync, createReadStream, statSync, writeFileSync } from "fs"
import { join } from "path"
import { Readable } from "stream"
```

Add routes at the end of the file (before any default export):

```typescript
sessionRoutes.post("/:id/files", async (c) => {
  const sessionId = c.req.param("id")
  const session = sessions.getSessionRecord(sessionId)
  if (!session) {
    return c.json({ error: "Session not found" }, 404)
  }

  const workspacePath = sessions.getWorkspacePath()
  ensureSessionDirs(workspacePath, sessionId)
  const inputDir = getSessionInputDir(workspacePath, sessionId)

  const formData = await c.req.formData()
  const files: Array<{ filename: string; size: number }> = []

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      const filename = value.name || key
      const safeName = filename.replace(/[/\\]/g, "_")
      const buffer = Buffer.from(await value.arrayBuffer())
      writeFileSync(join(inputDir, safeName), buffer)
      files.push({ filename: safeName, size: buffer.length })
    }
  }

  return c.json({ files })
})

sessionRoutes.get("/:id/files", async (c) => {
  const sessionId = c.req.param("id")
  const workspacePath = sessions.getWorkspacePath()

  const inputFiles = listSessionFiles(workspacePath, sessionId, "input")
  const outputFiles = listSessionFiles(workspacePath, sessionId, "output")

  return c.json({
    input: inputFiles.map((f) => ({ filename: f.filename, size: f.size })),
    output: outputFiles.map((f) => ({ filename: f.filename, size: f.size })),
  })
})

sessionRoutes.get("/:id/files/:filename", async (c) => {
  const sessionId = c.req.param("id")
  const filename = c.req.param("filename")
  const workspacePath = sessions.getWorkspacePath()

  const outputPath = join(getSessionOutputDir(workspacePath, sessionId), filename)
  const inputPath = join(getSessionInputDir(workspacePath, sessionId), filename)
  const filePath = existsSync(outputPath) ? outputPath : existsSync(inputPath) ? inputPath : null

  if (!filePath) {
    return c.json({ error: "File not found" }, 404)
  }

  const stat = statSync(filePath)
  const stream = createReadStream(filePath)
  const webStream = Readable.toWeb(stream) as ReadableStream

  return new Response(webStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(stat.size),
    },
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/routes/sessions.ts
git commit -m "feat: add file upload, listing, and download routes for per-session directories"
```

### Task 21: API client functions for file operations

**Files:**
- Modify: `src/api/client.ts`

- [ ] **Step 1: Add file API functions**

Add after the existing `answerSessionQuestion` function (~line 228):

```typescript
export async function uploadSessionFiles(sessionId: string, files: File[]) {
  const formData = new FormData()
  for (const file of files) {
    formData.append(file.name, file)
  }
  const res = await fetch(`${BASE}/sessions/${sessionId}/files`, {
    method: "POST",
    body: formData,
  })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  return res.json() as Promise<{ files: Array<{ filename: string; size: number }> }>
}

export async function getSessionFiles(sessionId: string) {
  return request<{
    input: Array<{ filename: string; size: number }>
    output: Array<{ filename: string; size: number }>
  }>(`/sessions/${sessionId}/files`)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api/client.ts
git commit -m "feat: add file upload and listing API client functions"
```

### Task 22: Ensure session directories on session creation

**Files:**
- Modify: `server/lib/session-manager.ts`

- [ ] **Step 1: Import ensureSessionDirs**

Add to the existing import from render-output:

```typescript
import { validateRenderOutput, ensureSessionDirs } from "./render-output.js"
```

- [ ] **Step 2: Create directories when a session starts**

In `startSession()`, inside the init message handler (after `createSessionRecord()` at ~line 283), add:

```typescript
ensureSessionDirs(workspacePath, sessionId!)
```

- [ ] **Step 3: Add session directory env vars for resumed sessions**

Create a helper that builds a session-aware env:

```typescript
function buildSessionAgentEnv(sessionId: string): Record<string, string> {
  const env = buildAgentEnv()
  const sessionDir = `${workspacePath}/sessions/${sessionId}`
  env.SESSION_DIR = sessionDir
  env.SESSION_INPUT_DIR = `${sessionDir}/input`
  env.SESSION_OUTPUT_DIR = `${sessionDir}/output`
  return env
}
```

In `resumeSessionQuery()` (~line 368), change `env: buildAgentEnv()` to:

```typescript
env: buildSessionAgentEnv(sessionId),
```

- [ ] **Step 4: Run tests**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/session-manager.ts
git commit -m "feat: create per-session file directories on session start and expose in agent env"
```

---

## Chunk 6: OutputRenderer Tests

### Task 23: OutputRenderer render tests

**Files:**
- Create: `src/components/session/__tests__/OutputRenderer.test.tsx`

- [ ] **Step 1: Install @testing-library/react if not present**

Run: `cd packages/inbox && npm ls @testing-library/react 2>/dev/null || npm install -D @testing-library/react`

- [ ] **Step 2: Write render tests**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { OutputRenderer } from "../OutputRenderer"
import type { MarkdownOutput, JsonOutput } from "@/types"

// Mock lazy-loaded components to avoid Suspense issues in tests
vi.mock("../outputs/HtmlOutput", () => ({
  default: ({ html }: { html: string }) => <div data-testid="html-output">{html.slice(0, 50)}</div>,
}))
vi.mock("../outputs/TableOutput", () => ({
  default: ({ rows }: any) => <div data-testid="table-output">{rows.length} rows</div>,
}))
vi.mock("../outputs/JsonTree", () => ({
  default: ({ data }: any) => <div data-testid="json-tree">{JSON.stringify(data)}</div>,
}))
vi.mock("../outputs/VegaChart", () => ({
  default: () => <div data-testid="vega-chart">chart</div>,
}))
vi.mock("../outputs/FileCard", () => ({
  default: ({ file }: any) => <div data-testid="file-card">{file.filename}</div>,
}))
vi.mock("../outputs/ConversationView", () => ({
  default: ({ messages }: any) => <div data-testid="conversation">{messages.length} messages</div>,
}))
vi.mock("../outputs/ArtifactFrame", () => ({
  default: () => <div data-testid="artifact-frame">artifact</div>,
}))

describe("OutputRenderer", () => {
  it("renders markdown output inline", () => {
    const output: MarkdownOutput = { type: "markdown", data: "# Hello" }
    render(<OutputRenderer output={output} sessionId="s1" sequence={0} />)
    expect(screen.getByText("Hello")).toBeTruthy()
  })

  it("renders a panel card when panel: true and onOpenPanel provided", () => {
    const output: MarkdownOutput = { type: "markdown", data: "test", title: "Report", panel: true }
    const onOpen = vi.fn()
    render(<OutputRenderer output={output} sessionId="s1" sequence={0} onOpenPanel={onOpen} />)
    expect(screen.getByText("Open panel")).toBeTruthy()
    expect(screen.getByText("Report")).toBeTruthy()
  })

  it("renders title when provided", () => {
    const output: JsonOutput = { type: "json", data: { key: "value" }, title: "Config" }
    render(<OutputRenderer output={output} sessionId="s1" sequence={0} />)
    expect(screen.getByText("Config")).toBeTruthy()
  })

  it("renders inline when panel: true but no onOpenPanel handler", () => {
    const output: MarkdownOutput = { type: "markdown", data: "# Inline", panel: true }
    render(<OutputRenderer output={output} sessionId="s1" sequence={0} />)
    expect(screen.getByText("Inline")).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run tests**

Run: `cd packages/inbox && npx vitest run src/components/session/__tests__/OutputRenderer.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/session/__tests__/OutputRenderer.test.tsx
git commit -m "test: add OutputRenderer component render tests"
```

---

## Chunk 7: Integration and Documentation

### Task 24: Update workflow-plugin CLAUDE.md with per-session file convention

**Files:**
- Modify: `packages/agent/CLAUDE.md`

- [ ] **Step 1: Document the per-session file directory convention**

Add a section to the agent's CLAUDE.md:

```markdown
## Per-Session File Directories

Sessions that run through the inbox app have dedicated file directories:

```
$SESSION_DIR/
  input/    # User-uploaded files, attached context
  output/   # Generated artifacts (reports, exports, WORKFLOW.md)
```

Environment variables available during session execution:
- `SESSION_DIR` — root session directory
- `SESSION_INPUT_DIR` — user-uploaded files
- `SESSION_OUTPUT_DIR` — write generated files here

When generating files (reports, exports, etc.), write them to `$SESSION_OUTPUT_DIR`.
The inbox app serves files from this directory and renders `file` type outputs as download cards.
```

- [ ] **Step 2: Commit**

```bash
git add packages/agent/CLAUDE.md
git commit -m "docs: document per-session file directory convention"
```

### Task 25: Full test suite and manual verification

- [ ] **Step 1: Run full test suite**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS (all existing + new tests)

- [ ] **Step 2: Manual smoke test**

1. Start a session and ask the agent to use `render_output` with type "markdown"
2. Verify markdown renders inline in the transcript
3. Test `render_output` with type "table" — verify sortable table renders
4. Test `render_output` with type "json" — verify collapsible tree renders
5. Test `render_output` with type "react" and simple code — verify iframe renders
6. Test `render_output` with `panel: true` — verify "Open panel" card appears, click opens side panel
7. Upload a file via the file upload route — verify it appears in the session directory
8. Verify React artifact state persists across page reloads (stored in user_preferences)

- [ ] **Step 3: Update TODO.md**

Mark Phase 4 items as done in `TODO.md` and `PLAN.md`.

---

## Summary

| Chunk | Tasks | Key Files |
|-------|-------|-----------|
| 1: render_output tool | Tasks 1-3 | `types/index.ts`, `server/lib/render-output.ts`, `server/lib/session-manager.ts` |
| 2: OutputRenderer components | Tasks 4-11 | `OutputRenderer.tsx`, `outputs/*.tsx`, `SessionTranscript.tsx` |
| 3: TabGrid + ephemeral panels | Tasks 12-14 | `TabGrid.tsx`, `use-artifact-panels.ts`, `SessionView.tsx` |
| 4: React artifacts | Tasks 15-17 | `artifact-sandbox.ts`, `ArtifactFrame.tsx` |
| 5: Per-session files | Tasks 18-22 | `render-output.ts`, `sessions.ts` routes, `session-manager.ts` |
| 6: Tests | Task 23 | `__tests__/OutputRenderer.test.tsx` |
| 7: Integration | Tasks 24-25 | `CLAUDE.md`, manual verification |

**New dependencies:** `vega`, `vega-lite`, `vega-embed` (chart rendering), `@testing-library/react` (dev, if not present)

**No new DB tables.** Artifact state persisted via existing `user_preferences` table (composite PK: `user_email, key`). The frontend's `usePreference()` hook (from `src/hooks/use-preferences.ts`) handles this transparently — it calls `GET /preferences` and `PUT /preferences`, and the server resolves `user_email` from the session cookie. The frontend does not need to know or pass the user email. File storage is filesystem-based under the workspace directory.
