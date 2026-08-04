import { useState, useEffect, useRef, useMemo } from "react"
import { Markdown } from "@hammies/frontend/components/Markdown"
import { codeBlockComponents } from "@hammies/frontend/components/MarkdownCodeBlock"
import { FileText, Download, ChevronRight, ChevronDown, User, Bot, Image, Film, Code2, FileCode } from "lucide-react"
import { DataTable } from "@hammies/frontend/components/DataTable"
import { cn } from "@hammies/frontend/lib/utils"
import { useResolvedDark } from "@hammies/frontend/hooks"
import { THEME_VARS, IFRAME_BASE_CSS, injectIntoHtml } from "@hammies/frontend/lib/iframe-theme"
import { getSessionFileUrl } from "@/api/client"
import { ArtifactFrame } from "./ArtifactFrame"
import { unwrapReactData } from "@hammies/frontend/lib/artifact-transform"
import {
  ArtifactToHostMessageSchema,
  decodeIframeMessage,
} from "@hammies/contracts/iframe"

// --- Spec types ---

// The spec union is the shared artifact wire format — one definition both apps
// and the shared transcript component type against.
export type {
  OutputSpec,
  TableData,
  ChartData,
  FileData,
  ConversationData,
  ReactArtifactData,
} from "@hammies/session-core"
import type { OutputSpec, TableData, ChartData, FileData, ConversationData } from "@hammies/session-core"
import { normalizeChartData } from "@hammies/session-core"

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
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
  /** Called when a react artifact iframe reports its height (fully loaded) */
  onArtifactLoaded?: () => void
}

export function OutputRenderer({ spec, sessionId, sequence, fillPanel, onAction, onArtifactLoaded }: OutputRendererProps) {
  switch (spec.type) {
    case "markdown":
      return <MarkdownOutput data={spec.data} />
    case "html":
      return <HtmlOutput data={spec.data} fillPanel={fillPanel} />
    case "table":
      return <TableOutput data={spec.data} fillPanel={fillPanel} />
    case "json":
      return <JsonOutput data={spec.data} />
    case "chart": {
      const chartData = normalizeChartData(spec.data)
      if (!chartData) return <div className="text-xs text-muted-foreground">Invalid chart data</div>
      return <ChartOutput data={chartData} />
    }
    case "file": {
      // Model may send data as a string (just the path) or { name, path, mimeType? }
      const fileData: FileData = typeof spec.data === "string"
        ? { name: "", path: spec.data }
        : spec.data
      return <FileOutput data={fileData} sessionId={sessionId} fillPanel={fillPanel} />
    }
    case "conversation":
      return <ConversationOutput data={spec.data} />
    case "react": {
      const reactData = unwrapReactData(spec.data)
      if (!reactData.code) {
        return <JsonOutput data={spec.data} />
      }
      return (
        <ArtifactFrame
          code={reactData.code}
          title={reactData.title}
          sessionId={sessionId}
          sequence={sequence}
          className={fillPanel ? "w-full h-full border-0" : undefined}
          onAction={onAction}
          onHeightReported={onArtifactLoaded}
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
    <Markdown size="sm" components={codeBlockComponents} className="p-4 overflow-x-auto">
      {data}
    </Markdown>
  )
}

// --- HTML ---

const HEIGHT_SCRIPT = `<script>(function(){function r(){var h=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);window.parent.postMessage({contractVersion:1,type:'html-height',height:h},'*')}if(document.readyState==='complete'){r()}else{window.addEventListener('load',r)}})()</script>`


/** Snapshot current computed theme vars into a <style> block for cross-origin iframes.
 *  Recomputes when the resolved theme changes (manual toggle or OS dark mode). */
function useThemeStyle(): string {
  const isDark = useResolvedDark()
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement)
    const vars = THEME_VARS
      .map(v => { const val = style.getPropertyValue(`--${v}`).trim(); return val ? `--${v}:${val}` : "" })
      .filter(Boolean)
      .join(";")
    return `<style>:root{${vars}}${IFRAME_BASE_CSS}</style>`
  }, [isDark])
}

function useIframeAutoHeight(max = 600) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(300)
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      const source = ref.current?.contentWindow
      if (!source) return
      const decoded = decodeIframeMessage(
        e,
        { source, origin: "null" },
        ArtifactToHostMessageSchema,
        "html-frame-to-host@1",
      )
      if (decoded.success && decoded.data.type === "html-height") {
        setHeight(Math.min(decoded.data.height, max))
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [max])
  return { ref, height }
}

function HtmlOutput({ data, fillPanel }: { data: string; fillPanel?: boolean }) {
  const { ref: iframeRef, height } = useIframeAutoHeight()
  const themeStyle = useThemeStyle()

  const srcDoc = useMemo(() => injectIntoHtml(data, themeStyle, HEIGHT_SCRIPT), [data, themeStyle])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-popups allow-downloads"
      className={cn("w-full border-0 transition-[height]", fillPanel ? "h-full" : "")}
      style={!fillPanel ? { height } : undefined}
      title="HTML output"
    />
  )
}

// --- Table ---

/**
 * `searchable` tracks `fillPanel`: the filter belongs to the EXPANDED grid, not
 * to the inline one. Inline, a table is one block in a scrolling transcript —
 * a search field there is chrome on a preview, and a row of them down a long
 * transcript reads as noise. Expanded into its own panel the grid IS the view,
 * and filtering it is the point of having opened it.
 */
function TableOutput({ data, fillPanel }: { data: TableData; fillPanel?: boolean }) {
  if (fillPanel) {
    return (
      <div className="h-full">
        <DataTable columns={data.columns} rows={data.rows} paginated={false} searchable />
      </div>
    )
  }
  return <DataTable columns={data.columns} rows={data.rows} pageSize={20} searchable={false} />
}

// --- JSON tree ---

function JsonOutput({ data }: { data: unknown }) {
  return (
    <div className="max-h-80 overflow-y-auto overflow-x-auto font-mono">
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
    const items: unknown[] = [...value]
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
        {!collapsed && items.map((item, i) => (
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
      color: colors?.[key] ?? CHART_COLORS[i % CHART_COLORS.length]!,
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts element types (Line|Area|Bar) share props but don't share a union type
  if (type === "pie") {
    // Pie chart needs special handling — data is the slice values
    const pieData = chartData.map((d) => ({
      name: String(d[xKey] ?? ""),
      value: Number(d[yKeys[0]!] ?? 0),
      fill: colors?.[String(d[xKey])] ?? CHART_COLORS[chartData.indexOf(d) % CHART_COLORS.length],
    }))

    return (
      <ChartContainer config={config} className="h-[250px] w-full">
        <Recharts.PieChart>
          <ChartTooltip content={<ChartTooltipContent />} />
          <Recharts.Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label />
        </Recharts.PieChart>
      </ChartContainer>
    )
  }

  return (
    <ChartContainer config={config} className="h-[250px] w-full">
      <Recharts.ComposedChart data={chartData}>
          <Recharts.CartesianGrid vertical={false} className="stroke-border" />
          <Recharts.XAxis dataKey={xKey} tickLine={false} axisLine={false} className="text-xs" />
          <Recharts.YAxis tickLine={false} axisLine={false} className="text-xs" />
          <ChartTooltip content={<ChartTooltipContent />} />
          {yKeys.map((key) => {
            const series = config[key]!
            if (type === "bar") {
              return <Recharts.Bar key={key} dataKey={key} fill={series.color} stroke={series.color} radius={[4, 4, 0, 0]} />
            }
            if (type === "area") {
              return <Recharts.Area key={key} dataKey={key} fill={series.color} stroke={series.color} strokeWidth={2} fillOpacity={0.3} />
            }
            return <Recharts.Line key={key} dataKey={key} fill={series.color} stroke={series.color} strokeWidth={2} dot={false} />
          })}
        </Recharts.ComposedChart>
      </ChartContainer>
  )
}

// --- File output ---

const INLINE_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico"])
const INLINE_VIDEO_EXTS = new Set(["mp4", "webm", "ogg"])
const INLINE_HTML_EXTS = new Set(["html", "htm"])
const CODE_EXTS = new Set(["ts", "tsx", "js", "jsx", "py", "rb", "go", "rs"])
const ICON_CLS = "h-4 w-4 text-muted-foreground shrink-0"

function getFileExt(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? ""
}

function resolveFileName(data: FileData): string {
  if (data.name) return data.name
  if (data.path) {
    const segments = data.path.replace(/\\/g, "/").split("/")
    return segments[segments.length - 1] || "file"
  }
  return "file"
}

function fileIcon(ext: string) {
  if (INLINE_IMAGE_EXTS.has(ext)) return <Image className={ICON_CLS} />
  if (INLINE_VIDEO_EXTS.has(ext)) return <Film className={ICON_CLS} />
  if (INLINE_HTML_EXTS.has(ext)) return <FileCode className={ICON_CLS} />
  if (CODE_EXTS.has(ext)) return <Code2 className={ICON_CLS} />
  return <FileText className={ICON_CLS} />
}

function FileOutput({ data, sessionId, fillPanel }: { data: FileData; sessionId: string; fillPanel?: boolean }) {
  const name = resolveFileName(data)
  const ext = getFileExt(name)
  const downloadUrl = getSessionFileUrl(sessionId, name, data.path)
  const isImage = INLINE_IMAGE_EXTS.has(ext)
  const isVideo = INLINE_VIDEO_EXTS.has(ext)
  const isHtml = INLINE_HTML_EXTS.has(ext)
  const isInline = isImage || isVideo || isHtml

  // Fetch HTML content and inject height script — avoids allow-same-origin
  // (which would trigger CORS on external images like Klaviyo CDN assets)
  const themeStyle = useThemeStyle()
  const [rawHtml, setRawHtml] = useState<string | null>(null)
  useEffect(() => {
    if (!isHtml) return
    fetch(downloadUrl)
      .then(r => r.text())
      .then(setRawHtml)
      .catch((err: unknown) => console.warn("[output] Failed to fetch HTML file:", err))
  }, [downloadUrl, isHtml])

  const htmlSrcDoc = useMemo(() => {
    if (!rawHtml) return null
    return injectIntoHtml(rawHtml, themeStyle, HEIGHT_SCRIPT)
  }, [rawHtml, themeStyle])

  const { ref: htmlRef, height: htmlHeight } = useIframeAutoHeight()

  return (
    <div className={cn(fillPanel && isHtml ? "flex flex-col h-full" : "space-y-0")}>
      {/* Inline preview for browser-native types */}
      {isImage && (
        <div className="flex justify-center bg-muted/30">
          <img
            src={downloadUrl}
            alt={name}
            className="max-w-full object-contain rounded"
          />
        </div>
      )}
      {isVideo && (
        <div className="">
          <video
            src={downloadUrl}
            controls
            className="max-w-full rounded"
          />
        </div>
      )}
      {isHtml && htmlSrcDoc && (
        <iframe
          ref={htmlRef}
          srcDoc={htmlSrcDoc}
          sandbox="allow-scripts allow-popups allow-downloads"
          className={cn("w-full border-0 transition-[height]", fillPanel ? "flex-1 min-h-0" : "")}
          style={!fillPanel ? { height: htmlHeight } : undefined}
          title={name}
        />
      )}

      {/* Attachment bar — always shown */}
      <div className={cn(
        "flex items-center gap-3",
        isInline ? "border-t bg-muted/20" : "",
      )}>
        {fileIcon(ext)}
        <span className="text-xs font-medium truncate flex-1 min-w-0">{name}</span>
        {data.mimeType && !isInline && (
          <span className="text-xs text-muted-foreground shrink-0">{data.mimeType}</span>
        )}
        <a
          href={downloadUrl}
          download={name}
          className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
          title="Download"
        >
          <Download className="h-4 w-4" />
        </a>
      </div>
    </div>
  )
}

// --- Conversation ---

function ConversationOutput({ data }: { data: ConversationData }) {
  // Handle data sent as array directly or with missing messages field
  const raw: unknown = data
  const messages: Array<{ role: string; content: string }> = Array.isArray(raw)
    ? ([...raw] as unknown[]).filter(
        (message: unknown): message is { role: string; content: string } =>
          isRecord(message) && typeof message.role === "string" && typeof message.content === "string",
      )
    : data.messages
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
