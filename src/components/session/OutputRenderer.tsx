import { useState, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { FileText, Download, ChevronRight, ChevronDown, User, Bot } from "lucide-react"
import { DataTable } from "@/components/shared/DataTable"
import { cn } from "@hammies/frontend/lib/utils"
import { getSessionFileUrl } from "@/api/client"
import { ArtifactFrame } from "./ArtifactFrame"

// --- Spec types ---

export type OutputSpec =
  | { type: "markdown"; data: string; title?: string }
  | { type: "html"; data: string; title?: string }
  | { type: "table"; data: TableData; title?: string }
  | { type: "json"; data: unknown; title?: string }
  | { type: "chart"; data: ChartData; title?: string }
  | { type: "file"; data: FileData; title?: string }
  | { type: "conversation"; data: ConversationData; title?: string }
  | { type: "react"; data: ReactArtifactData; title?: string }

export interface TableData {
  columns: string[]
  rows: unknown[][]
}

export interface ChartData {
  /** Chart type */
  type?: "bar" | "line" | "area" | "pie"
  /** Array of data points, e.g. [{ month: "Jan", revenue: 100 }] */
  data: Record<string, unknown>[]
  /** Field name for x-axis / category */
  xKey: string
  /** Field names for y-axis series */
  yKeys: string[]
  /** Optional labels for series (defaults to yKey names) */
  labels?: Record<string, string>
  /** Optional colors for series (defaults to chart-1, chart-2, etc.) */
  colors?: Record<string, string>
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
  /** Called when an artifact sends an action intent via sendAction() */
  onAction?: (intent: string) => void
}

export function OutputRenderer({ spec, sessionId, sequence, fillPanel, onAction }: OutputRendererProps) {
  switch (spec.type) {
    case "markdown":
      return <MarkdownOutput data={spec.data} />
    case "html":
      return <HtmlOutput data={spec.data} />
    case "table":
      return <TableOutput data={spec.data} />
    case "json":
      return <JsonOutput data={spec.data} />
    case "chart": {
      const chartData = normalizeChartData(spec.data)
      if (!chartData) return <div className="p-4 text-xs text-muted-foreground">Invalid chart data</div>
      return <ChartOutput data={chartData} />
    }
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
          className={fillPanel ? "w-full h-full border-0 p-4" : undefined}
          onAction={onAction}
        />
      )
    }
    default:
      return (
        <div className="p-4 text-xs text-muted-foreground">
          Unknown output type
        </div>
      )
  }
}

// --- Markdown ---

function MarkdownOutput({ data }: { data: string }) {
  return (
    <div className="p-4 prose prose-sm max-w-none dark:prose-invert overflow-x-auto">
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

function TableOutput({ data }: { data: TableData }) {
  return (
    <div className="p-1">
      <DataTable columns={data.columns} rows={data.rows} />
    </div>
  )
}

// --- JSON tree ---

function JsonOutput({ data }: { data: unknown }) {
  return (
    <div className="p-4 max-h-80 overflow-y-auto overflow-x-auto font-mono">
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

// --- Chart (Recharts via shadcn ChartContainer) ---

/**
 * Normalize chart data — accepts our ChartData format or simple Vega-Lite specs
 * (backward compat with old sessions). Complex Vega-Lite should use type "react".
 */
function normalizeChartData(raw: any): ChartData | null {
  if (!raw) return null

  // Already our format
  if (raw.xKey && raw.yKeys) return raw as ChartData

  // Simple Vega-Lite spec: extract fields from encoding + inline data
  const encoding = raw.encoding
  const values = raw.data?.values
  if (encoding && Array.isArray(values) && encoding.x?.field && encoding.y?.field) {
    const markType = typeof raw.mark === "string" ? raw.mark : raw.mark?.type
    return {
      type: markType === "line" ? "line" : markType === "area" ? "area" : markType === "arc" ? "pie" : "bar",
      data: values,
      xKey: encoding.x.field,
      yKeys: [encoding.y.field],
    }
  }

  return null
}

function ChartOutput({ data }: { data: ChartData }) {
  const [Recharts, setRecharts] = useState<typeof import("recharts") | null>(null)
  const [ChartComponents, setChartComponents] = useState<typeof import("@hammies/frontend/components/ui/chart") | null>(null)

  useEffect(() => {
    Promise.all([
      import("recharts"),
      import("@hammies/frontend/components/ui/chart"),
    ]).then(([rc, cc]) => {
      setRecharts(rc)
      setChartComponents(cc)
    })
  }, [])

  if (!Recharts || !ChartComponents || !data?.data) {
    return <div className="p-4 text-xs text-muted-foreground">Loading chart...</div>
  }

  const { type = "bar", data: chartData, xKey, yKeys = [], labels, colors } = data
  const { ChartContainer, ChartTooltip, ChartTooltipContent } = ChartComponents

  const CHART_COLORS = [
    "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)",
  ]

  // Build ChartConfig from yKeys
  const config: Record<string, { label: string; color: string }> = {}
  yKeys.forEach((key, i) => {
    config[key] = {
      label: labels?.[key] ?? key,
      color: colors?.[key] ?? CHART_COLORS[i % CHART_COLORS.length],
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ChartElement: any = type === "line" ? Recharts.Line
    : type === "area" ? Recharts.Area
    : Recharts.Bar

  if (type === "pie") {
    // Pie chart needs special handling — data is the slice values
    const pieData = chartData.map((d) => ({
      name: String(d[xKey] ?? ""),
      value: Number(d[yKeys[0]] ?? 0),
      fill: colors?.[String(d[xKey])] ?? CHART_COLORS[chartData.indexOf(d) % CHART_COLORS.length],
    }))

    return (
      <div className="p-4">
        <ChartContainer config={config} className="h-[250px] w-full">
          <Recharts.PieChart>
            <ChartTooltip content={<ChartTooltipContent />} />
            <Recharts.Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label />
          </Recharts.PieChart>
        </ChartContainer>
      </div>
    )
  }

  return (
    <div className="p-4">
      <ChartContainer config={config} className="h-[250px] w-full">
        <Recharts.ComposedChart data={chartData}>
          <Recharts.CartesianGrid vertical={false} className="stroke-border" />
          <Recharts.XAxis dataKey={xKey} tickLine={false} axisLine={false} className="text-xs" />
          <Recharts.YAxis tickLine={false} axisLine={false} className="text-xs" />
          <ChartTooltip content={<ChartTooltipContent />} />
          {yKeys.map((key) => (
            <ChartElement
              key={key}
              dataKey={key}
              fill={config[key].color}
              stroke={config[key].color}
              radius={type === "bar" ? [4, 4, 0, 0] as any : undefined}
              strokeWidth={type !== "bar" ? 2 : undefined}
              fillOpacity={type === "area" ? 0.3 : undefined}
              dot={type === "line" ? false : undefined}
            />
          ))}
        </Recharts.ComposedChart>
      </ChartContainer>
    </div>
  )
}

// --- File card ---

function FileOutput({ data, sessionId }: { data: FileData; sessionId: string }) {
  const downloadUrl = getSessionFileUrl(sessionId, data.name)

  return (
    <div className="flex items-center gap-4 p-4">
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
  // Handle data sent as array directly or with missing messages field
  const messages = Array.isArray(data) ? data : data?.messages ?? []
  return (
    <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
      {messages.map((msg, i) => {
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
