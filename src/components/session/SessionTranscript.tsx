import { useMemo, useRef, useEffect, useCallback, memo, useState, Children, isValidElement, type ReactNode } from "react"
import { useTranscriptScroll } from "@/hooks/use-transcript-scroll"
import { useUserProfiles } from "@/hooks/use-user-profiles"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { FileText, ChevronRight, Paperclip, AppWindow, Maximize2, Zap } from "lucide-react"
import type { SessionMessage, InboxContextData, InboxResultData } from "@/types"
import type { SessionMessagePayload, ContentBlock as ContentBlockType, TextBlock, ToolUseBlock, UserMessage, AssistantMessage } from "@/types/session-message"
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
import { useEditingCode, artifactEditorKey } from "@/hooks/use-artifact-editor"

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
  isLive?: boolean
  visibility?: TranscriptVisibility
  sessionId?: string
  currentUserEmail?: string
  currentUserPicture?: string
  onOpenPanel?: (spec: OutputSpec, sequence: number) => void
  onAction?: (intent: string) => void
  /** Called when all inline artifacts have reported their height */
  onArtifactsReady?: () => void
}

export function SessionTranscript({
  messages,
  isStreaming,
  visibility = DEFAULT_TRANSCRIPT_VISIBILITY,
  sessionId,
  currentUserEmail,
  currentUserPicture,
  onOpenPanel,
  onAction,
  onArtifactsReady,
}: SessionTranscriptProps) {
  const { scrollRef, virtualizer, visibleMessages, handleScroll } = useTranscriptScroll({
    messages,
    visibility,
    sessionId,
    shouldRenderMessage,
  })
  const userProfiles = useUserProfiles(messages)
  const toolResultMap = useMemo(() => buildToolResultMap(messages), [messages])

  // Track artifact loading: count expected render_output blocks vs reported heights
  const expectedArtifacts = useMemo(() => {
    let count = 0
    for (const m of visibleMessages) {
      const blocks = getContentBlocks(m.message as any)
      for (const b of blocks) {
        if (b.type === "tool_use" && (b.name === "render_output" || b.name === "mcp__render_output__render_output")) {
          count++
        }
      }
    }
    return count
  }, [visibleMessages])

  const artifactsLoadedRef = useRef(0)
  const artifactsReadyFired = useRef(false)
  // Reset when session changes
  if (artifactsLoadedRef.current > expectedArtifacts) {
    artifactsLoadedRef.current = 0
    artifactsReadyFired.current = false
  }

  const handleArtifactLoaded = useCallback(() => {
    artifactsLoadedRef.current++
    if (artifactsLoadedRef.current >= expectedArtifacts && !artifactsReadyFired.current) {
      artifactsReadyFired.current = true
      onArtifactsReady?.()
    }
  }, [expectedArtifacts, onArtifactsReady])

  // If no artifacts, fire ready via effect (not during render)
  useEffect(() => {
    if (expectedArtifacts === 0 && !artifactsReadyFired.current && visibleMessages.length > 0) {
      artifactsReadyFired.current = true
      onArtifactsReady?.()
    }
  }, [expectedArtifacts, visibleMessages.length, onArtifactsReady])

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
                <TranscriptEntry message={visibleMessages[virtualRow.index]} visibility={visibility} sessionId={sessionId} currentUserEmail={currentUserEmail} currentUserPicture={currentUserPicture} userProfiles={userProfiles} toolResultMap={toolResultMap} onOpenPanel={onOpenPanel} onAction={onAction} onArtifactLoaded={handleArtifactLoaded} />
              </div>
            ))}
          </div>
        ) : (
          <PanelSkeleton />
        )}
        {isStreaming && (
          <div className="flex justify-center py-4">
            <div className="flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 rounded-full bg-muted-foreground animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.6s" }}
                />
              ))}
            </div>
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
  label,
  color,
  bold = true,
  defaultOpen = false,
  extra,
  children,
}: {
  label: string
  color: string
  bold?: boolean
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
        className="flex items-center gap-1.5 py-1.5 w-full text-left"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform duration-200 text-muted-foreground ${open ? "rotate-90" : ""}`}
        />
        <span className={`text-xs ${bold ? "font-medium" : ""} ${color} truncate`}>{label}</span>
        {extra}
      </button>
      {open && <div className="pl-[18px]">{children}</div>}
    </div>
  )
}

function MessageBubble({ label, align, transparent, children }: { label: string; align: "left" | "right"; transparent?: boolean; children: ReactNode }) {
  return (
    <div className={`flex flex-col ${align === "right" ? "items-end" : "items-start"}`}>
      <span className="text-xs font-medium text-foreground py-1.5">{label}</span>
      <div className={`rounded-md px-3 py-2 ${transparent ? "" : "bg-secondary"}`}>
        {children}
      </div>
    </div>
  )
}

function OutputAccordion({
  spec,
  sessionId,
  sequence,
  onOpenPanel,
  onAction,
  onArtifactLoaded,
}: {
  spec: OutputSpec
  sessionId: string
  sequence: number
  onOpenPanel?: (spec: OutputSpec, sequence: number) => void
  onAction?: (intent: string) => void
  onArtifactLoaded?: () => void
}) {
  const [open, setOpen] = useState(true)
  // Sync with live code edits from the code editor panel
  const editorKey = artifactEditorKey(sessionId, sequence)
  const editingCode = useEditingCode(editorKey)
  const activeSpec = useMemo((): OutputSpec => {
    if (editingCode == null || spec.type !== "react") return spec
    const data = typeof spec.data === "string" ? { code: editingCode } : { ...spec.data, code: editingCode }
    return { ...spec, data }
  }, [spec, editingCode])

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 py-1.5 w-full">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
        >
          <ChevronRight
            className={`h-3 w-3 shrink-0 transition-transform duration-200 text-muted-foreground ${open ? "rotate-90" : ""}`}
          />
          <AppWindow className="h-3.5 w-3.5 text-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground truncate">{spec.title || spec.type}</span>
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
        <div className="pl-[18px]">
          <OutputRenderer
            spec={activeSpec}
            sessionId={sessionId}
            sequence={sequence}
            onAction={onAction}
            onArtifactLoaded={onArtifactLoaded}
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
  currentUserPicture,
  userProfiles,
  toolResultMap,
  onOpenPanel,
  onAction,
  onArtifactLoaded,
}: {
  message: SessionMessage
  visibility: TranscriptVisibility
  sessionId?: string
  currentUserEmail?: string
  currentUserPicture?: string
  userProfiles?: Map<string, { name: string; picture?: string }>
  toolResultMap?: Map<string, string>
  onOpenPanel?: (spec: OutputSpec, sequence: number) => void
  onAction?: (intent: string) => void
  onArtifactLoaded?: () => void
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

          label="Result"
          color="text-foreground"
          defaultOpen
        >
          <div className="prose prose-sm max-w-none dark:prose-invert overflow-x-auto">
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
        <div className="flex items-center gap-1.5 py-1.5">
          <Zap className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground">{actionMatch[1]}</span>
        </div>
      )
    }

    // Skill context injection — render collapsed with skill name
    const skillBlock = extractSkillBlock(msg)
    if (skillBlock) {
      return (
        <TranscriptAccordionEntry

          label={skillBlock.name}
          color="text-muted-foreground"
          bold={false}
        >
          <div className="prose prose-sm max-w-none dark:prose-invert overflow-x-auto">
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
    const profile = msg.authorEmail ? userProfiles?.get(msg.authorEmail) : undefined
    const authorLabel = isCurrentUser ? "You" : (profile?.name || msg.authorName || "User")
    return (
      <MessageBubble label={authorLabel} align="right">
        <div className="space-y-1.5">
          {text && <div className="text-sm whitespace-pre-wrap break-words">{text}</div>}
          {ideRefs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-end">
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
      </MessageBubble>
    )
  }

  if (msg.type === "assistant") {
    const contentBlocks = getContentBlocks(msg)
    if (contentBlocks.length === 0) {
      if (!visibility.messages) return null
      const text = extractText(msg)
      if (!text) return null
      return <MarkdownEntry text={text} />
    }

    const grouped = groupContentBlocks(contentBlocks)
    return (
      <div className="space-y-1">
        {grouped.map((item, i) => {
          if (Array.isArray(item)) {
            if (!visibility.toolCalls) return null
            return <ToolCallGroup key={i} blocks={item} sequence={message.sequence} startIndex={contentBlocks.indexOf(item[0])} toolResultMap={toolResultMap} />
          }
          return <ContentBlockView key={i} block={item} sequence={message.sequence} visibility={visibility} sessionId={sessionId} toolResultMap={toolResultMap} onOpenPanel={onOpenPanel} onAction={onAction} onArtifactLoaded={onArtifactLoaded} />
        })}
      </div>
    )
  }

  if (msg.type === "plan") {
    if (!visibility.messages) return null
    return (
      <TranscriptAccordionEntry

        label="Plan"
        color="text-foreground"
        defaultOpen
      >
        <div className="prose prose-sm max-w-none dark:prose-invert overflow-x-auto">
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

function MarkdownEntry({ text }: { text: string }) {
  return (
    <MessageBubble label="Claude" align="left" transparent>
      <div className="prose prose-sm max-w-none dark:prose-invert overflow-x-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
          {text}
        </ReactMarkdown>
      </div>
    </MessageBubble>
  )
}

function ContentBlockView({
  block,
  sequence,
  visibility,
  sessionId,
  toolResultMap,
  onOpenPanel,
  onAction,
  onArtifactLoaded,
}: {
  block: ContentBlockType
  sequence: number
  visibility: TranscriptVisibility
  sessionId?: string
  toolResultMap?: Map<string, string>
  onOpenPanel?: (spec: OutputSpec, sequence: number) => void
  onAction?: (intent: string) => void
  onArtifactLoaded?: () => void
}) {
  const { data: panelSchemas } = useQuery({
    queryKey: ["panel-schemas"],
    queryFn: getPanelSchemas,
    staleTime: 60_000,
  })
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
            {rest && <MarkdownEntry text={rest} />}
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
            {rest && <MarkdownEntry text={rest} />}
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
                {rest && <MarkdownEntry text={rest} />}
              </>
            )
          } catch { /* fall through */ }
        }
      }
    }

    return <MarkdownEntry text={block.text} />
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
          onArtifactLoaded={onArtifactLoaded}
        />
      )
    }

    if (!visibility.toolCalls) return null
    const summary = toolUseSummary(block.name, block.input)
    return (
      <TranscriptAccordionEntry

        label={summary ? `${block.name} ${summary}` : block.name}
        color="text-muted-foreground"
        bold={false}
      >
        <ToolCallDetail name={block.name} input={block.input} toolUseId={block.id} toolResultMap={toolResultMap} />
      </TranscriptAccordionEntry>
    )
  }

  if (block.type === "thinking") {
    if (!block.thinking || !visibility.thinking) return null
    return (
      <TranscriptAccordionEntry

        label="Thinking"
        color="text-muted-foreground"
        bold={false}
        defaultOpen
      >
        <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
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

/** Group consecutive non-render_output tool_use blocks into arrays; other blocks stay individual. */
function groupContentBlocks(blocks: ContentBlockType[]): Array<ContentBlockType | ToolUseBlock[]> {
  const groups: Array<ContentBlockType | ToolUseBlock[]> = []
  let toolGroup: ToolUseBlock[] = []

  for (const block of blocks) {
    if (
      block.type === "tool_use" &&
      block.name !== "render_output" &&
      block.name !== "mcp__render_output__render_output"
    ) {
      toolGroup.push(block)
    } else {
      if (toolGroup.length > 0) {
        groups.push(toolGroup)
        toolGroup = []
      }
      groups.push(block)
    }
  }
  if (toolGroup.length > 0) groups.push(toolGroup)
  return groups
}

/** A single accordion containing multiple tool calls. */
function ToolCallGroup({ blocks, sequence, startIndex, toolResultMap }: { blocks: ToolUseBlock[]; sequence: number; startIndex: number; toolResultMap?: Map<string, string> }) {
  const summary = blocks.length === 1 ? toolUseSummary(blocks[0].name, blocks[0].input) : ""
  const label = blocks.length === 1
    ? (summary ? `${blocks[0].name} ${summary}` : blocks[0].name)
    : blocks.map((b) => b.name).join(", ")

  return (
    <TranscriptAccordionEntry

      label={label}
      color="text-muted-foreground"
      bold={false}
    >
      <div className="space-y-2">
        {blocks.map((block, i) => (
          <ToolCallDetail key={i} name={block.name} input={block.input} toolUseId={block.id} toolResultMap={toolResultMap} />
        ))}
      </div>
    </TranscriptAccordionEntry>
  )
}

/** Structured display of a single tool call: name, command, and tool output. */
function ToolCallDetail({ name, input, toolUseId, toolResultMap }: { name: string; input: Record<string, unknown>; toolUseId?: string; toolResultMap?: Map<string, string> }) {
  const [showOutput, setShowOutput] = useState(false)
  const command = toolUseCommand(name, input)
  const resultText = toolUseId ? toolResultMap?.get(toolUseId) : undefined

  return (
    <div className="border-l-2 border-border pl-3 py-1 min-w-0">
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{name}</div>
      {command && (
        <div className="overflow-x-auto">
          <pre className="text-[11px] text-muted-foreground font-mono whitespace-pre">{command}</pre>
        </div>
      )}
      {resultText && (
        <>
          <button
            type="button"
            className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground mt-0.5"
            onClick={() => setShowOutput((s) => !s)}
          >
            {showOutput ? "Hide output" : "Show output"}
          </button>
          {showOutput && (
            <pre className="text-[11px] rounded overflow-x-auto max-h-[300px] overflow-y-auto text-muted-foreground font-mono whitespace-pre-wrap break-words mt-1">
              {resultText}
            </pre>
          )}
        </>
      )}
    </div>
  )
}

const TOOL_PRIMARY_FIELD: Record<string, string> = {
  Read: "file_path", Write: "file_path", Edit: "file_path",
  Glob: "pattern", Grep: "pattern",
  WebFetch: "url", WebSearch: "query",
}

/** Short summary for accordion labels (e.g. file path, description). */
function toolUseSummary(name: string, input: Record<string, unknown>): string {
  if (!input) return ""
  const str = (key: string): string => (typeof input[key] === "string" ? input[key] : "")
  if (name === "Bash") return str("description") || (typeof input.command === "string" ? input.command.slice(0, 60) : "")
  return TOOL_PRIMARY_FIELD[name] ? str(TOOL_PRIMARY_FIELD[name]) : ""
}

/** Raw command/input for the detail view (e.g. actual bash command, not description). */
function toolUseCommand(name: string, input: Record<string, unknown>): string {
  if (!input) return ""
  const str = (key: string): string => (typeof input[key] === "string" ? input[key] : "")
  if (name === "Bash") return str("command")
  return TOOL_PRIMARY_FIELD[name] ? str(TOOL_PRIMARY_FIELD[name]) : ""
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
    // System-injected messages (skill content, tool results) — not user-typed
    if (("isSynthetic" in msg && msg.isSynthetic) || ("isMeta" in msg && msg.isMeta)) return false
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

/** Build a map from tool_use_id → result text by scanning all messages for tool_result content blocks. */
function buildToolResultMap(messages: SessionMessage[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of messages) {
    const raw = m.message as unknown as Record<string, unknown>
    // Tool result messages have content blocks with type "tool_result" and a tool_use_id.
    // They can be at raw.content, raw.message.content, or via the toolUseResult field.
    const contentSources = [
      raw.content,
      (raw.message as Record<string, unknown> | undefined)?.content,
    ]
    for (const content of contentSources) {
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          block.type === "tool_result" &&
          typeof block.tool_use_id === "string"
        ) {
          const text = typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
              ? block.content.map((c: any) => c.text || "").join("\n")
              : ""
          if (text) map.set(block.tool_use_id, text)
        }
      }
    }
  }
  return map
}
