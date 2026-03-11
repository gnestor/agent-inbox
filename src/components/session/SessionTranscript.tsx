import { useRef, useEffect, useMemo, memo, useState, Children, isValidElement, type ElementType, type ReactNode } from "react"
import { useVirtualizerSafe } from "@/hooks/use-virtualizer-safe"
import { User, Bot, Wrench, Brain, Loader2, FileText, ChevronDown } from "lucide-react"
import type { SessionMessage, InboxContextData, InboxResultData } from "@/types"
import { ContextPanel } from "./ContextPanel"
import { InboxResultPanel } from "./InboxResultPanel"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import hljs from "highlight.js/lib/core"
import json from "highlight.js/lib/languages/json"

hljs.registerLanguage("json", json)

// Unwrap immediate children matching `tag` — e.g. strip <strong> inside headings,
// <p> inside <li> (ReactMarkdown wraps loose-list items in <p>).
function unwrapTag(children: ReactNode, tag: string): ReactNode {
  return Children.map(children, (child) =>
    isValidElement(child) && child.type === tag
      ? (child.props as { children: ReactNode }).children
      : child
  )
}

const markdownComponents = {
  h1: ({ children, node: _n, ...props }: any) => <h1 {...props}>{unwrapTag(children, "strong")}</h1>,
  h2: ({ children, node: _n, ...props }: any) => <h2 {...props}>{unwrapTag(children, "strong")}</h2>,
  h3: ({ children, node: _n, ...props }: any) => <h3 {...props}>{unwrapTag(children, "strong")}</h3>,
  h4: ({ children, node: _n, ...props }: any) => <h4 {...props}>{unwrapTag(children, "strong")}</h4>,
  li: ({ children, node: _n, ordered: _o, ...props }: any) => (
    <li {...props}>{unwrapTag(children, "p")}</li>
  ),
}

export interface TranscriptVisibility {
  messages: boolean
  toolCalls: boolean
  thinking: boolean
}

export const DEFAULT_TRANSCRIPT_VISIBILITY: TranscriptVisibility = {
  messages: true,
  toolCalls: true,
  thinking: true,
}

interface SessionTranscriptProps {
  messages: SessionMessage[]
  isStreaming: boolean
  status?: string
  messageCount?: number
  isLive?: boolean
  visibility?: TranscriptVisibility
  sessionId?: string
}

export function SessionTranscript({
  messages,
  isStreaming,
  visibility = DEFAULT_TRANSCRIPT_VISIBILITY,
  sessionId,
}: SessionTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)

  const virtualizer = useVirtualizerSafe({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    // estimateSize must be <= the minimum actual item height (accordion trigger
    // ~44px). When items are taller than the estimate, measuring them increases
    // total size → items only EXIT the virtual window, never enter → no new
    // commitAttachRef calls → the flushSpawnedWork cascade terminates at depth 1.
    // If estimate > any item height, that item's measurement DECREASES total size,
    // adding new items to the window → more commitAttachRef → deeper cascade →
    // "Maximum update depth exceeded" after 50 levels.
    estimateSize: () => 44,
    overscan: 5,
    // Defers ResizeObserver callbacks to requestAnimationFrame so accordion open
    // animations (which fire ResizeObserver ~60×/sec) don't trigger synchronous
    // React state updates during the commit phase.
    useAnimationFrameWithResizeObserver: true,
  })

  // Auto-scroll to bottom when new messages arrive, unless the user has scrolled up.
  const needsScrollRef = useRef(false)
  useEffect(() => {
    if (shouldAutoScroll.current && messages.length > 0) {
      needsScrollRef.current = true
    }
  }, [messages.length])

  // Re-run whenever totalSize changes (items measured via ResizeObserver).
  // Iteratively scrolls toward the last item until it enters the rendered range,
  // at which point the position is accurate and we stop.
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
      style={{ overscrollBehavior: "contain" }}
      onScroll={handleScroll}
    >
      <div className="p-4 space-y-4 min-w-0">
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
                <TranscriptEntry message={messages[virtualRow.index]} visibility={visibility} sessionId={sessionId} />
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

// Simple toggle — intentionally avoids base-ui Accordion/AccordionItem.
// base-ui's CompositeList registers each AccordionItem via setState in
// useLayoutEffect. When many virtual rows mount simultaneously (one per
// message), each with multiple content blocks (each with its own AccordionItem),
// the total exceeds React 19's 50-nested-update limit and throws
// "Maximum update depth exceeded". Local useState has no registration cascade.
function TranscriptAccordionEntry({
  value: _,
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
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 py-2 w-full text-left"
      >
        <Icon className={`h-3.5 w-3.5 ${color} shrink-0`} />
        <span className={`text-xs font-medium ${color}`}>{label}</span>
        {extra}
        <ChevronDown
          className={`h-3 w-3 ml-auto shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

const TranscriptEntry = memo(function TranscriptEntry({
  message,
  visibility,
  sessionId,
}: {
  message: SessionMessage
  visibility: TranscriptVisibility
  sessionId?: string
}) {
  const msg = message.message as any

  if (msg.type === "system") {
    if (msg.subtype === "init") return null
    if (msg.subtype === "result" || "result" in msg) {
      if (!visibility.messages) return null
      return (
        <TranscriptAccordionEntry
          value={`result-${message.sequence}`}
          icon={Bot}
          label="Result"
          color="text-chart-1"
          defaultOpen
        >
          <div className="prose prose-sm max-w-none dark:prose-invert pl-5.5 overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
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
          <div className="prose prose-sm max-w-none dark:prose-invert pl-5.5 overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
              {skillBlock.content}
            </ReactMarkdown>
          </div>
        </TranscriptAccordionEntry>
      )
    }

    if (!visibility.messages) return null
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
      if (!visibility.messages) return null
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
          <div className="prose prose-sm max-w-none dark:prose-invert pl-5.5 overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
              {text}
            </ReactMarkdown>
          </div>
        </TranscriptAccordionEntry>
      )
    }

    return (
      <div className="space-y-1">
        {contentBlocks.map((block: any, i: number) => (
          <ContentBlock key={i} block={block} sequence={message.sequence} index={i} visibility={visibility} sessionId={sessionId} />
        ))}
      </div>
    )
  }

  if (msg.type === "tool_result") {
    return null
  }

  return null
})

function MarkdownEntry({ value, text }: { value: string; text: string }) {
  return (
    <TranscriptAccordionEntry value={value} icon={Bot} label="Claude" color="text-chart-4" defaultOpen>
      <div className="prose prose-sm max-w-none dark:prose-invert pl-5.5 overflow-x-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {text}
        </ReactMarkdown>
      </div>
    </TranscriptAccordionEntry>
  )
}

function ContentBlock({
  block,
  sequence,
  index,
  visibility,
  sessionId,
}: {
  block: any
  sequence: number
  index: number
  visibility: TranscriptVisibility
  sessionId?: string
}) {
  const id = `${sequence}-${index}`

  if (block.type === "text") {
    if (!block.text || !visibility.messages) return null

    const inboxContextJson = extractXmlTag(block.text, "inbox-context")
    if (inboxContextJson) {
      try {
        const data = JSON.parse(inboxContextJson) as InboxContextData
        const rest = block.text.replace(/<inbox-context>[\s\S]*?<\/inbox-context>/, "").trim()
        return (
          <>
            <ContextPanel data={data} />
            {rest && <MarkdownEntry value={`text-${id}`} text={rest} />}
          </>
        )
      } catch { /* fall through to normal render */ }
    }

    const inboxResultJson = extractXmlTag(block.text, "inbox-result")
    if (inboxResultJson) {
      try {
        const data = JSON.parse(inboxResultJson) as InboxResultData
        const rest = block.text.replace(/<inbox-result>[\s\S]*?<\/inbox-result>/, "").trim()
        return (
          <>
            <InboxResultPanel data={data} sessionId={sessionId ?? ""} />
            {rest && <MarkdownEntry value={`text-${id}`} text={rest} />}
          </>
        )
      } catch { /* fall through to normal render */ }
    }

    return <MarkdownEntry value={`text-${id}`} text={block.text} />
  }

  if (block.type === "tool_use") {
    if (!visibility.toolCalls) return null
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
    if (!block.thinking || !visibility.thinking) return null
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

export function extractXmlTag(text: string, tag: string): string | null {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  return match ? match[1].trim() : null
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
