import { useRef, useEffect, useMemo, memo, type ElementType, type ReactNode } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { User, Bot, Wrench, Brain, Loader2, FileText } from "lucide-react"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Badge,
  Table,
  TableBody,
  TableRow,
  TableCell,
} from "@hammies/frontend/components/ui"
import { sessionStatusLabel, sessionStatusColor } from "@/lib/formatters"
import type { SessionMessage } from "@/types"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import hljs from "highlight.js/lib/core"
import json from "highlight.js/lib/languages/json"

hljs.registerLanguage("json", json)

interface SessionTranscriptProps {
  messages: SessionMessage[]
  isStreaming: boolean
  status?: string
  messageCount?: number
  isLive?: boolean
}

export function SessionTranscript({
  messages,
  isStreaming,
  status,
  messageCount,
  isLive,
}: SessionTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 10,
  })

  // Auto-scroll to bottom when new messages arrive (streaming or initial load).
  const needsScrollRef = useRef(false)
  useEffect(() => {
    if (shouldAutoScroll.current && messages.length > 0) {
      needsScrollRef.current = true
    }
  }, [messages.length])

  // Re-run on every totalSize change (items being measured via ResizeObserver).
  // Each iteration scrolls toward the last item using best available measurements.
  // The loop terminates once the last item enters the rendered range, confirming
  // its position is accurate. This handles both:
  //   - Small sessions: estimated total < viewport → scrollToIndex says "no scroll
  //     needed" on first call; re-fires after measurement expands the total size.
  //   - Large sessions: estimates far from reality → iteratively converges as items
  //     near the scroll target are rendered and measured each iteration.
  const totalSize = virtualizer.getTotalSize()
  useEffect(() => {
    if (!needsScrollRef.current) return
    const idx = messages.length - 1
    virtualizer.scrollToIndex(idx, { align: "end" })
    if (virtualizer.getVirtualItems().some((vi) => vi.index === idx)) {
      needsScrollRef.current = false
    }
  }, [totalSize])

  function handleScroll() {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 100
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto overflow-x-hidden"
      onScroll={handleScroll}
    >
      <div className="p-4 space-y-4 min-w-0">
        {status && (
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="text-muted-foreground font-medium">Status</TableCell>
                <TableCell>
                  <span className={`text-xs font-medium ${sessionStatusColor(status)}`}>
                    {sessionStatusLabel(status)}
                  </span>
                  {isLive && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 ml-2">
                      Live
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
              {(messageCount ?? 0) > 0 && (
                <TableRow>
                  <TableCell className="text-muted-foreground font-medium">Messages</TableCell>
                  <TableCell>{messageCount}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
        {messages.length > 0 ? (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <TranscriptEntry message={messages[virtualRow.index]} />
              </div>
            ))}
          </div>
        ) : !isStreaming ? (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <p className="text-sm">No messages yet</p>
          </div>
        ) : null}
        {isStreaming && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Agent is working...</span>
          </div>
        )}
      </div>
    </div>
  )
}

function TranscriptAccordionEntry({
  value,
  icon: Icon,
  label,
  color,
  defaultOpen = false,
  extra,
  children,
}: {
  value: string
  icon: ElementType
  label: string
  color: string
  defaultOpen?: boolean
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <Accordion defaultValue={defaultOpen ? [value] : []}>
      <AccordionItem value={value} className="border-0 min-w-0">
        <AccordionTrigger className="py-2 hover:no-underline">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={`h-3.5 w-3.5 ${color} shrink-0`} />
            <span className={`text-xs font-medium ${color}`}>{label}</span>
            {extra}
          </div>
        </AccordionTrigger>
        <AccordionContent>{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

const TranscriptEntry = memo(function TranscriptEntry({ message }: { message: SessionMessage }) {
  const msg = message.message as any

  if (msg.type === "system") {
    if (msg.subtype === "init") return null
    if (msg.subtype === "result" || "result" in msg) {
      return (
        <TranscriptAccordionEntry
          value={`result-${message.sequence}`}
          icon={Bot}
          label="Result"
          color="text-chart-1"
          defaultOpen
        >
          <div className="text-sm prose prose-sm max-w-none dark:prose-invert pl-5.5 overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {msg.result || "Session completed"}
            </ReactMarkdown>
          </div>
        </TranscriptAccordionEntry>
      )
    }
    return null
  }

  if (msg.type === "user" || msg.role === "user") {
    // Skill context injection — render collapsed with skill name
    const skillBlock = extractSkillBlock(msg)
    if (skillBlock) {
      return (
        <TranscriptAccordionEntry
          value={`skill-${message.sequence}`}
          icon={Wrench}
          label={skillBlock.name}
          color="text-muted-foreground"
        >
          <div className="text-sm prose prose-sm max-w-none dark:prose-invert pl-5.5 overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {skillBlock.content}
            </ReactMarkdown>
          </div>
        </TranscriptAccordionEntry>
      )
    }

    const text = extractText(msg)
    const ideRefs = parseIdeContext(msg)
    if (!text && ideRefs.length === 0) return null
    return (
      <TranscriptAccordionEntry
        value={`user-${message.sequence}`}
        icon={User}
        label="You"
        color="text-chart-2"
        defaultOpen
      >
        <div className="pl-5.5 space-y-1.5">
          {text && <div className="text-sm whitespace-pre-wrap break-words">{text}</div>}
          {ideRefs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {ideRefs.map((ref, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/50 border border-border/50 rounded px-1.5 py-0.5"
                >
                  <FileText className="h-3 w-3 shrink-0" />
                  <span>
                    {ref.filename}
                    {ref.selectionLines ? `:${ref.selectionLines}` : ""}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </TranscriptAccordionEntry>
    )
  }

  if (msg.type === "assistant" || msg.role === "assistant") {
    const contentBlocks = msg.content || msg.message?.content || []
    if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) {
      const text = extractText(msg)
      if (!text) return null
      return (
        <TranscriptAccordionEntry
          value={`assistant-${message.sequence}`}
          icon={Bot}
          label="Claude"
          color="text-chart-4"
          defaultOpen
        >
          <div className="text-sm prose prose-sm max-w-none dark:prose-invert pl-5.5 overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {text}
            </ReactMarkdown>
          </div>
        </TranscriptAccordionEntry>
      )
    }

    return (
      <div className="space-y-1">
        {contentBlocks.map((block: any, i: number) => (
          <ContentBlock key={i} block={block} sequence={message.sequence} index={i} />
        ))}
      </div>
    )
  }

  if (msg.type === "tool_result") {
    return null
  }

  return null
})

function ContentBlock({ block, sequence, index }: { block: any; sequence: number; index: number }) {
  const id = `${sequence}-${index}`

  if (block.type === "text") {
    if (!block.text) return null
    return (
      <TranscriptAccordionEntry
        value={`text-${id}`}
        icon={Bot}
        label="Claude"
        color="text-chart-4"
        defaultOpen
      >
        <div className="text-sm prose prose-sm max-w-none dark:prose-invert pl-5.5 overflow-x-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {block.text}
          </ReactMarkdown>
        </div>
      </TranscriptAccordionEntry>
    )
  }

  if (block.type === "tool_use") {
    const summary = toolUseSummary(block.name, block.input)
    return (
      <TranscriptAccordionEntry
        value={`tool-${id}`}
        icon={Wrench}
        label={block.name}
        color="text-muted-foreground"
        extra={
          summary ? (
            <span className="text-xs text-muted-foreground truncate">{summary}</span>
          ) : undefined
        }
      >
        {block.input && <HighlightedJson data={block.input} className="pl-5.5" />}
      </TranscriptAccordionEntry>
    )
  }

  if (block.type === "thinking") {
    if (!block.thinking) return null
    return (
      <TranscriptAccordionEntry
        value={`thinking-${id}`}
        icon={Brain}
        label="Thinking"
        color="text-primary"
      >
        <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words pl-5.5">
          {block.thinking}
        </div>
      </TranscriptAccordionEntry>
    )
  }

  return null
}

function HighlightedJson({ data, className }: { data: any; className?: string }) {
  // hljs.highlight only produces <span class="hljs-*"> tags — safe to use with dangerouslySetInnerHTML
  const html = useMemo(
    () => hljs.highlight(JSON.stringify(data, null, 2), { language: "json" }).value,
    [data],
  )
  return (
    <pre
      className={`text-[11px] rounded overflow-x-auto max-h-[300px] overflow-y-auto ${className || ""}`}
    >
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}

function toolUseSummary(name: string, input: any): string {
  if (!input) return ""
  switch (name) {
    case "Read":
      return input.file_path || ""
    case "Write":
      return input.file_path || ""
    case "Edit":
      return input.file_path || ""
    case "Bash":
      return (
        input.description || (typeof input.command === "string" ? input.command.slice(0, 60) : "")
      )
    case "Glob":
      return input.pattern || ""
    case "Grep":
      return input.pattern || ""
    case "WebFetch":
      return input.url || ""
    case "WebSearch":
      return input.query || ""
    default:
      return ""
  }
}

function isIdeContextBlock(block: any): boolean {
  const text = block.text || ""
  return text.startsWith("<ide_opened_file>") || text.startsWith("<ide_selection>")
}

function extractSkillBlock(msg: any): { name: string; content: string } | null {
  const blocks: any[] = Array.isArray(msg.content)
    ? msg.content
    : Array.isArray(msg.message?.content)
      ? msg.message.content
      : []
  const skillBlock = blocks.find(
    (b: any) => b.type === "text" && (b.text || "").startsWith("Base directory for this skill:"),
  )
  if (!skillBlock) return null
  const text: string = skillBlock.text
  // Extract skill name from the directory path on the first line
  const dirMatch = text.match(/Base directory for this skill: .+\/(.+)/)
  const name = dirMatch ? dirMatch[1] : "Skill"
  // Strip the first line (the directory line) from the displayed content
  const content = text.replace(/^Base directory for this skill:[^\n]*\n?/, "").trim()
  return { name, content }
}

function parseIdeContext(
  msg: any,
): Array<{ type: "file" | "selection"; path: string; filename: string; selectionLines?: string }> {
  const refs: Array<{
    type: "file" | "selection"
    path: string
    filename: string
    selectionLines?: string
  }> = []
  const blocks: any[] = Array.isArray(msg.content)
    ? msg.content
    : Array.isArray(msg.message?.content)
      ? msg.message.content
      : []
  for (const block of blocks) {
    if (!isIdeContextBlock(block)) continue
    const text = block.text || ""
    const fileMatch = text.match(/<ide_opened_file>The user opened the file (.+?) in the IDE/)
    if (fileMatch) {
      const path = fileMatch[1]
      refs.push({ type: "file", path, filename: path.split("/").pop() || path })
      continue
    }
    const selMatch = text.match(
      /<ide_selection>The user selected the lines (\d+) to (\d+) from (.+?):/,
    )
    if (selMatch) {
      const path = selMatch[3]
      refs.push({
        type: "selection",
        path,
        filename: path.split("/").pop() || path,
        selectionLines: `${selMatch[1]}-${selMatch[2]}`,
      })
    }
  }
  return refs
}

function extractText(msg: any): string {
  if (typeof msg.content === "string") return msg.content
  if (typeof msg.text === "string") return msg.text
  if (msg.message?.content) {
    if (typeof msg.message.content === "string") return msg.message.content
    if (Array.isArray(msg.message.content)) {
      return msg.message.content
        .filter((b: any) => b.type === "text" && !isIdeContextBlock(b))
        .map((b: any) => b.text)
        .join("\n")
    }
  }
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b: any) => b.type === "text" && !isIdeContextBlock(b))
      .map((b: any) => b.text)
      .join("\n")
  }
  return ""
}
