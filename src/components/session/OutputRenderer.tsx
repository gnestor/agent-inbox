import { useState, useMemo, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@hammies/frontend/components/ui"
import { FileText, Download, ChevronRight, ChevronDown, User, Bot } from "lucide-react"
import { cn } from "@hammies/frontend/lib/utils"
import { ArtifactFrame } from "./ArtifactFrame"

// --- Spec types ---

export type OutputSpec =
  | { type: "markdown"; data: string; title?: string; panel?: boolean }
  | { type: "html"; data: string; title?: string; panel?: boolean }
  | { type: "table"; data: TableData; title?: string; panel?: boolean }
  | { type: "json"; data: unknown; title?: string; panel?: boolean }
  | { type: "chart"; data: VegaSpec; title?: string; panel?: boolean }
  | { type: "file"; data: FileData; title?: string; panel?: boolean }
  | { type: "conversation"; data: ConversationData; title?: string; panel?: boolean }
  | { type: "react"; data: ReactArtifactData; title?: string; panel?: boolean }

export interface TableData {
  columns: string[]
  rows: unknown[][]
}

export interface VegaSpec {
  [key: string]: unknown
}

export interface FileData {
  name: string
  path: string
  mimeType?: string
}

export interface ConversationData {
  messages: Array<{ role: string; content: string }>
}

export interface ReactArtifactData {
  code: string
  title?: string
}

// --- Main component ---

interface OutputRendererProps {
  spec: OutputSpec
  sessionId: string
  sequence: number
  /** When true, react artifacts fill the parent container instead of using a fixed height */
  fillPanel?: boolean
}

export function OutputRenderer({ spec, sessionId, sequence, fillPanel }: OutputRendererProps) {
  if (fillPanel) {
    return <OutputContent spec={spec} sessionId={sessionId} sequence={sequence} fillPanel />
  }

  return <OutputContent spec={spec} sessionId={sessionId} sequence={sequence} />
}

function OutputContent({
  spec,
  sessionId,
  sequence,
  fillPanel,
}: {
  spec: OutputSpec
  sessionId: string
  sequence: number
  fillPanel?: boolean
}) {
  switch (spec.type) {
    case "markdown":
      return <MarkdownOutput data={spec.data} />
    case "html":
      return <HtmlOutput data={spec.data} />
    case "table":
      return <TableOutput data={spec.data} />
    case "json":
      return <JsonOutput data={spec.data} />
    case "chart":
      return <ChartOutput data={spec.data} />
    case "file":
      return <FileOutput data={spec.data} sessionId={sessionId} />
    case "conversation":
      return <ConversationOutput data={spec.data} />
    case "react": {
      // Model may send data as a string (just code) or { code, title }
      const reactData = typeof spec.data === "string" ? { code: spec.data } : spec.data
      return (
        <ArtifactFrame
          code={reactData.code}
          title={reactData.title}
          sessionId={sessionId}
          sequence={sequence}
          className={fillPanel ? "w-full h-full border-0" : undefined}
        />
      )
    }
    default:
      return (
        <div className="p-3 text-xs text-muted-foreground">
          Unknown output type
        </div>
      )
  }
}

// --- Markdown ---

function MarkdownOutput({ data }: { data: string }) {
  return (
    <div className="p-3 prose prose-sm max-w-none dark:prose-invert overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {data}
      </ReactMarkdown>
    </div>
  )
}

// --- HTML ---

function HtmlOutput({ data }: { data: string }) {
  return (
    <iframe
      srcDoc={data}
      sandbox="allow-scripts"
      className="w-full border-0"
      style={{ height: "300px" }}
      title="HTML output"
    />
  )
}

// --- Table ---

type SortDirection = "asc" | "desc" | null

function TableOutput({ data }: { data: TableData }) {
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDir, setSortDir] = useState<SortDirection>(null)

  const sortedRows = useMemo(() => {
    if (sortCol === null || sortDir === null) return data.rows
    return [...data.rows].sort((a, b) => {
      const av = a[sortCol]
      const bv = b[sortCol]
      const cmp = String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true })
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [data.rows, sortCol, sortDir])

  function handleSort(colIdx: number) {
    if (sortCol === colIdx) {
      setSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"))
      if (sortDir === "desc") setSortCol(null)
    } else {
      setSortCol(colIdx)
      setSortDir("asc")
    }
  }

  return (
    <div className="overflow-x-auto max-h-80 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {data.columns.map((col, i) => (
              <TableHead
                key={i}
                className="cursor-pointer select-none whitespace-nowrap"
                onClick={() => handleSort(i)}
              >
                <span className="flex items-center gap-1">
                  {col}
                  {sortCol === i && sortDir === "asc" && <ChevronRight className="h-3 w-3 rotate-90 shrink-0" />}
                  {sortCol === i && sortDir === "desc" && <ChevronDown className="h-3 w-3 shrink-0" />}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.map((row, ri) => (
            <TableRow key={ri}>
              {row.map((cell, ci) => (
                <TableCell key={ci} className="text-xs">
                  {String(cell ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// --- JSON tree ---

function JsonOutput({ data }: { data: unknown }) {
  return (
    <div className="p-3 max-h-80 overflow-y-auto overflow-x-auto">
      <JsonTree value={data} depth={0} />
    </div>
  )
}

function JsonTree({ value, depth }: { value: unknown; depth: number }) {
  const [collapsed, setCollapsed] = useState(depth > 1)
  const indent = `${depth * 12}px`

  if (value === null) {
    return <span className="text-muted-foreground text-xs">null</span>
  }
  if (typeof value === "boolean") {
    return <span className={cn("text-xs", value ? "text-chart-1" : "text-chart-3")}>{String(value)}</span>
  }
  if (typeof value === "number") {
    return <span className="text-xs text-chart-2">{value}</span>
  }
  if (typeof value === "string") {
    return <span className="text-xs text-chart-4 break-all">&quot;{value}&quot;</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-xs text-muted-foreground">[]</span>
    return (
      <div style={{ paddingLeft: indent }}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          [{value.length}]
        </button>
        {!collapsed && value.map((item, i) => (
          <div key={i} className="flex items-start gap-1">
            <span className="text-xs text-muted-foreground shrink-0">{i}:</span>
            <JsonTree value={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    )
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span className="text-xs text-muted-foreground">{"{}"}</span>
    return (
      <div style={{ paddingLeft: indent }}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {"{"}…{"}"}
        </button>
        {!collapsed && entries.map(([k, v]) => (
          <div key={k} className="flex items-start gap-1">
            <span className="text-xs font-medium text-foreground/80 shrink-0">{k}:</span>
            <JsonTree value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    )
  }
  return <span className="text-xs text-muted-foreground">{String(value)}</span>
}

// --- Chart (Vega-Lite) ---
// Lazy-load react-vega to avoid it in the main bundle

function ChartOutput({ data }: { data: VegaSpec }) {
  const [VegaEmbed, setVegaEmbed] = useState<React.ComponentType<any> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    import("react-vega")
      .then((m) => setVegaEmbed(() => m.VegaEmbed))
      .catch(() => setError("Chart library not available. Install react-vega to render charts."))
  }, [])

  if (error) {
    return (
      <div className="p-3 text-xs text-muted-foreground">{error}</div>
    )
  }

  if (!VegaEmbed) {
    return (
      <div className="p-3 text-xs text-muted-foreground">Loading chart...</div>
    )
  }

  return (
    <div className="p-3 overflow-x-auto">
      <VegaEmbed spec={data} actions={false} />
    </div>
  )
}

// --- File card ---

function FileOutput({ data, sessionId }: { data: FileData; sessionId: string }) {
  const downloadUrl = `/api/sessions/${sessionId}/files/${encodeURIComponent(data.name)}`

  return (
    <div className="flex items-center gap-3 p-3">
      <FileText className="h-8 w-8 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{data.name}</p>
        {data.mimeType && (
          <p className="text-xs text-muted-foreground">{data.mimeType}</p>
        )}
      </div>
      <a
        href={downloadUrl}
        download={data.name}
        className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
        title="Download"
      >
        <Download className="h-4 w-4" />
      </a>
    </div>
  )
}

// --- Conversation ---

function ConversationOutput({ data }: { data: ConversationData }) {
  return (
    <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
      {data.messages.map((msg, i) => {
        const isUser = msg.role === "user"
        return (
          <div key={i} className={cn("flex items-start gap-2", isUser ? "" : "flex-row-reverse")}>
            <div className="shrink-0 mt-0.5">
              {isUser
                ? <User className="h-3.5 w-3.5 text-chart-2" />
                : <Bot className="h-3.5 w-3.5 text-chart-4" />
              }
            </div>
            <div
              className={cn(
                "rounded-lg px-3 py-2 text-sm max-w-[85%]",
                isUser ? "bg-muted" : "bg-card border border-border"
              )}
            >
              {msg.content}
            </div>
          </div>
        )
      })}
    </div>
  )
}
