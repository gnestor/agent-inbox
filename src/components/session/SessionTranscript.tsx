import { useMemo, memo, useState, Children, isValidElement, type ElementType, type ReactNode } from "react"
import { useTranscriptScroll } from "@/hooks/use-transcript-scroll"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { User, Bot, Wrench, Brain, Loader2, FileText, ChevronDown, ClipboardList, Paperclip, AppWindow, Maximize2, Zap } from "lucide-react"
import type { SessionMessage, InboxContextData, InboxResultData } from "@/types"
import type { SessionMessagePayload, ContentBlock as ContentBlockType, TextBlock, UserMessage, AssistantMessage } from "@/types/session-message"
import { ContextPanel } from "./ContextPanel"
import { InboxResultPanel } from "./InboxResultPanel"
import { useQuery } from "@tanstack/react-query"
import { getPanelSchemas } from "@/api/client"
import { PanelWidget } from "@/components/plugin/PanelWidget"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import hljs from "highlight.js/lib/core"
import json from "highlight.js/lib/languages/json"
import { OutputRenderer } from "./OutputRenderer"
import type { OutputSpec } from "./OutputRenderer"

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
  artifacts: boolean
}

export const DEFAULT_TRANSCRIPT_VISIBILITY: TranscriptVisibility = {
  messages: true,
  toolCalls: true,
  thinking: true,
  artifacts: true,
}

interface SessionTranscriptProps {
  messages: SessionMessage[]
  isStreaming: boolean
  status?: string
  messageCount?: number
  isLive?: boolean
  visibility?: TranscriptVisibility
  sessionId?: string
  currentUserEmail?: string
  onOpenPanel?: (spec: OutputSpec, sequence: number) => void
  onAction?: (intent: string) => void
}

export function SessionTranscript({
  messages,
  isStreaming,
  messageCount,
  visibility = DEFAULT_TRANSCRIPT_VISIBILITY,
  sessionId,
  currentUserEmail,
  onOpenPanel,
  onAction,
}: SessionTranscriptProps) {
  const { scrollRef, virtualizer, visibleMessages, handleScroll } = useTranscriptScroll({
    messages,
    visibility,
    isStreaming,
    sessionId,
    shouldRenderMessage,
  })

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto overflow-x-hidden"
      style={{ overscrollBehavior: "contain" }}
      onScroll={handleScroll}
    >
      <div className="p-4 min-w-0 pb-4">
        {visibleMessages.length > 0 ? (
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
                  paddingBottom: virtualRow.index === visibleMessages.length - 1 ? 0 : 12,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <TranscriptEntry message={visibleMessages[virtualRow.index]} visibility={visibility} sessionId={sessionId} currentUserEmail={currentUserEmail} onOpenPanel={onOpenPanel} onAction={onAction} />
              </div>
            ))}
          </div>
        ) : (
          <PanelSkeleton />
        )}
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
  picture,
  label,
  color,
  defaultOpen = false,
  extra,
  children,
}: {
  value: string
  icon: ElementType
  picture?: string
  label: string
  color: string
  defaultOpen?: boolean
  extra?: ReactNode
  children?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 py-2 w-full text-left"
      >
        {picture ? (
          <img src={picture} alt={label} className="h-3.5 w-3.5 rounded-full object-cover shrink-0" />
        ) : (
          <Icon className={`h-3.5 w-3.5 ${color} shrink-0`} />
        )}
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

function OutputAccordion({
  spec,
  sessionId,
  sequence,
  onOpenPanel,
  onAction,
}: {
  spec: OutputSpec
  sessionId: string
  sequence: number
  onOpenPanel?: (spec: OutputSpec, sequence: number) => void
  onAction?: (intent: string) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 py-2 w-full">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <AppWindow className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-medium text-primary truncate">{spec.title || spec.type}</span>
          <ChevronDown
            className={`h-3 w-3 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
        {onOpenPanel && (
          <button
            type="button"
            className="p-1 rounded-md hover:bg-secondary text-muted-foreground shrink-0"
            onClick={() => onOpenPanel(spec, sequence)}
            title="Open in panel"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="pl-5.5">
          <OutputRenderer
            spec={spec}
            sessionId={sessionId}
            sequence={sequence}
            onAction={onAction}
          />
        </div>
      )}
    </div>
  )
}

const TranscriptEntry = memo(function TranscriptEntry({
  message,
  visibility,
  sessionId,
  currentUserEmail,
  onOpenPanel,
  onAction,
}: {
  message: SessionMessage
  visibility: TranscriptVisibility
  sessionId?: string
  currentUserEmail?: string
  onOpenPanel?: (spec: OutputSpec, sequence: number) => void
  onAction?: (intent: string) => void
}) {
  const msg = message.message

  if (msg.type === "system") {
    if (msg.subtype === "init") return null
    if (msg.subtype === "attached_context") {
      if (!visibility.messages) return null
      return (
        <div className="flex items-start gap-2 px-4 py-2 bg-muted/50 rounded-md mx-4 my-1">
          <Paperclip className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-sm">
            <span className="font-medium">{msg.title}</span>
            <span className="text-muted-foreground ml-1">attached</span>
          </div>
        </div>
      )
    }
    if (msg.subtype === "result") {
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

  if (msg.type === "user") {
    const text = extractText(msg)

    // Artifact action — render as a compact system-like event
    const actionMatch = text?.match(/^<artifact_action\s+intent="([^"]*)">([\s\S]*?)<\/artifact_action>$/)
    if (actionMatch) {
      return (
        <TranscriptAccordionEntry
          value={`action-${message.sequence}`}
          icon={Zap}
          label={actionMatch[1]}
          color="text-chart-4"
        />
      )
    }

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
    const ideRefs = parseIdeContext(msg)
    if (!text && ideRefs.length === 0) return null
    const isCurrentUser = !msg.authorEmail || msg.authorEmail === currentUserEmail
    const authorLabel = isCurrentUser ? "You" : (msg.authorName || "User")
    const authorPicture = isCurrentUser ? undefined : msg.authorPicture
    const authorColor = isCurrentUser ? "text-chart-2" : "text-chart-3"
    return (
      <TranscriptAccordionEntry
        value={`user-${message.sequence}`}
        icon={User}
        picture={authorPicture}
        label={authorLabel}
        color={authorColor}
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

  if (msg.type === "assistant") {
    const contentBlocks = getContentBlocks(msg)
    if (contentBlocks.length === 0) {
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
        {contentBlocks.map((block, i) => (
          <ContentBlockView key={i} block={block} sequence={message.sequence} index={i} visibility={visibility} sessionId={sessionId} onOpenPanel={onOpenPanel} onAction={onAction} />
        ))}
      </div>
    )
  }

  if (msg.type === "plan") {
    if (!visibility.messages) return null
    return (
      <TranscriptAccordionEntry
        value={`plan-${message.sequence}`}
        icon={ClipboardList}
        label="Plan"
        color="text-chart-3"
        defaultOpen
      >
        <div className="prose prose-sm max-w-none dark:prose-invert pl-5.5 overflow-x-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
            {msg.content || ""}
          </ReactMarkdown>
        </div>
      </TranscriptAccordionEntry>
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

function ContentBlockView({
  block,
  sequence,
  index,
  visibility,
  sessionId,
  onOpenPanel,
  onAction,
}: {
  block: ContentBlockType
  sequence: number
  index: number
  visibility: TranscriptVisibility
  sessionId?: string
  onOpenPanel?: (spec: OutputSpec, sequence: number) => void
  onAction?: (intent: string) => void
}) {
  const { data: panelSchemas } = useQuery({
    queryKey: ["panel-schemas"],
    queryFn: getPanelSchemas,
    staleTime: 60_000,
  })
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

    // Check for registered panel tags from workflow plugins
    if (panelSchemas) {
      for (const [tag, widgets] of Object.entries(panelSchemas)) {
        const json = extractXmlTag(block.text, tag)
        if (json) {
          try {
            const data = JSON.parse(json) as Record<string, unknown>
            const rest = block.text.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`), "").trim()
            return (
              <>
                <div className="rounded-lg border p-3 bg-card">
                  <PanelWidget widgets={widgets} data={data} />
                </div>
                {rest && <MarkdownEntry value={`text-${id}`} text={rest} />}
              </>
            )
          } catch { /* fall through */ }
        }
      }
    }

    return <MarkdownEntry value={`text-${id}`} text={block.text} />
  }

  if (block.type === "tool_use") {
    // render_output tool — renders structured output in an accordion
    if ((block.name === "render_output" || block.name === "mcp__render_output__render_output") && block.input && sessionId) {
      if (!visibility.artifacts) return null
      const outputSpec = block.input as OutputSpec
      return (
        <OutputAccordion
          spec={outputSpec}
          sessionId={sessionId}
          sequence={sequence}
          onOpenPanel={onOpenPanel}
          onAction={onAction}
        />
      )
    }

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

function HighlightedJson({ data, className }: { data: unknown; className?: string }) {
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

function toolUseSummary(name: string, input: Record<string, unknown>): string {
  if (!input) return ""
  const str = (key: string): string => (typeof input[key] === "string" ? input[key] : "")
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
      return str("file_path")
    case "Bash":
      return str("description") || (typeof input.command === "string" ? input.command.slice(0, 60) : "")
    case "Glob":
    case "Grep":
      return str("pattern")
    case "WebFetch":
      return str("url")
    case "WebSearch":
      return str("query")
    default:
      return ""
  }
}

function shouldRenderMessage(message: SessionMessage, visibility: TranscriptVisibility): boolean {
  const msg = message.message

  if (msg.type === "system") {
    if (msg.subtype === "init") return false
    if (msg.subtype === "attached_context") return visibility.messages
    if (msg.subtype === "result") return visibility.messages
    return false
  }

  if (msg.type === "user") {
    // Synthetic messages are system-injected (skill content, etc.), not user-typed
    if ("isSynthetic" in msg && msg.isSynthetic) return false
    const text = extractText(msg)
    if (text?.startsWith("<artifact_action")) return true
    if (extractSkillBlock(msg)) return true
    if (!visibility.messages) return false
    return !!text || parseIdeContext(msg).length > 0
  }

  if (msg.type === "assistant") {
    const contentBlocks = getContentBlocks(msg)
    if (contentBlocks.length === 0) {
      return visibility.messages && !!extractText(msg)
    }
    return contentBlocks.some((block) => shouldRenderContentBlock(block, visibility, !!message.sessionId))
  }

  if (msg.type === "plan") return visibility.messages && !!msg.content
  if (msg.type === "tool_result") return false
  return false
}

function shouldRenderContentBlock(
  block: ContentBlockType,
  visibility: TranscriptVisibility,
  hasSessionId: boolean,
): boolean {
  if (block.type === "text") {
    return visibility.messages && !!block.text
  }

  if (block.type === "tool_use") {
    if (block.name === "render_output" || block.name === "mcp__render_output__render_output") {
      return visibility.artifacts && !!block.input && hasSessionId
    }
    return visibility.toolCalls
  }

  if (block.type === "thinking") {
    return visibility.thinking && !!block.thinking
  }

  return false
}

function isIdeContextBlock(block: ContentBlockType): boolean {
  if (block.type !== "text") return false
  return block.text.startsWith("<ide_opened_file>") || block.text.startsWith("<ide_selection>")
}

export function extractXmlTag(text: string, tag: string): string | null {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
  return match ? match[1].trim() : null
}

/** Get content blocks from a message, checking both direct and nested paths. */
function getContentBlocks(msg: UserMessage | AssistantMessage): ContentBlockType[] {
  if (Array.isArray(msg.content)) return msg.content as ContentBlockType[]
  if (Array.isArray(msg.message?.content)) return msg.message!.content as ContentBlockType[]
  return []
}

function extractSkillBlock(msg: UserMessage | AssistantMessage): { name: string; content: string } | null {
  const blocks = getContentBlocks(msg)
  const skillBlock = blocks.find(
    (b) => b.type === "text" && b.text.startsWith("Base directory for this skill:"),
  )
  if (!skillBlock || skillBlock.type !== "text") return null
  const text = skillBlock.text
  // Extract skill name from the directory path on the first line
  const dirMatch = text.match(/Base directory for this skill: .+\/(.+)/)
  const name = dirMatch ? dirMatch[1] : "Skill"
  // Strip the first line (the directory line) from the displayed content
  const content = text.replace(/^Base directory for this skill:[^\n]*\n?/, "").trim()
  return { name, content }
}

function parseIdeContext(
  msg: UserMessage | AssistantMessage,
): Array<{ type: "file" | "selection"; path: string; filename: string; selectionLines?: string }> {
  const refs: Array<{
    type: "file" | "selection"
    path: string
    filename: string
    selectionLines?: string
  }> = []
  const blocks = getContentBlocks(msg)
  for (const block of blocks) {
    if (!isIdeContextBlock(block)) continue
    if (block.type !== "text") continue
    const text = block.text
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

function isVisibleTextBlock(b: ContentBlockType): b is TextBlock {
  return b.type === "text" && !isIdeContextBlock(b)
}

function extractText(msg: SessionMessagePayload): string {
  if (msg.type === "plan") return msg.content
  if (msg.type === "system" || msg.type === "tool_result") return ""
  // User or assistant message — content can be string or ContentBlock[]
  if (typeof msg.content === "string") return msg.content
  if (msg.message?.content) {
    if (typeof msg.message.content === "string") return msg.message.content
    if (Array.isArray(msg.message.content)) {
      return (msg.message.content as ContentBlockType[])
        .filter(isVisibleTextBlock)
        .map((b) => b.text)
        .join("\n")
    }
  }
  if (Array.isArray(msg.content)) {
    return (msg.content as ContentBlockType[])
      .filter(isVisibleTextBlock)
      .map((b) => b.text)
      .join("\n")
  }
  return ""
}
