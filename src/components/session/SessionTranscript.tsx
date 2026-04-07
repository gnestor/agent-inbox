import { useMemo, useRef, useEffect, useCallback, memo, useState, createContext, useContext, Children, isValidElement, type ReactNode } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useTranscriptScroll } from "@/hooks/use-transcript-scroll"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { FileText, FileIcon, ChevronRight, Paperclip, Maximize2 } from "lucide-react"
import type { AskUserQuestion, InboxContextData, InboxResultData } from "@/types"
import type { ContentBlock as ContentBlockType, ToolUseBlock, AssistantMessage } from "@/types/session-message"
import { RENDER_OUTPUT_NAMES, CREATE_FILE_NAMES, PRESENT_FILES_NAMES } from "@/types/session-message"
import { ContextPanel } from "./ContextPanel"
import { InboxResultPanel } from "./InboxResultPanel"
import { useQuery } from "@tanstack/react-query"
import { getPanelSchemas, getSessionFileUrl } from "@/api/client"
import { PanelWidget } from "@/components/plugin/PanelWidget"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useRehypeHighlight } from "@/lib/lazy-rehype-highlight"
import { cn } from "@hammies/frontend/lib/utils"
import { useNavigation } from "@/hooks/use-navigation"
import { OutputRenderer } from "./OutputRenderer"
import type { OutputSpec } from "./OutputRenderer"
import { useEditingCode, artifactEditorKey } from "@/hooks/use-artifact-editor"
import { useAskUserForm } from "@/hooks/use-ask-user-form"
import { AskUserForm } from "./AskUserForm"
import type { MessageLookups, ClassifiedMessage, TranscriptVisibility } from "@/lib/session-pipeline"
import {
  extractXmlTag,
  getContentBlocks,
  toolUseSummary,
  toolUseCommand,
  isWriteArtifact,
  TOOL_DISPLAY_NAME,
  TOOLS_WITH_DESCRIPTION,
} from "@/lib/session-pipeline"

// ---------------------------------------------------------------------------
// Attachment parsing (module-scope to avoid per-render allocation)
// ---------------------------------------------------------------------------

const ATTACH_RE = /\[Attached:\s*(.+?)\s+at\s+(.+?)\]/g
const ATTACH_HEADER_RE = /Files attached:\s*/g
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico"])

function parseAttachments(text: string): { attachments: { name: string; path: string }[]; cleanText: string } {
  const attachments: { name: string; path: string }[] = []
  const cleanText = text.replace(ATTACH_RE, (_, name: string, path: string) => {
    attachments.push({ name, path })
    return ""
  }).replace(ATTACH_HEADER_RE, "").trim()
  return { attachments, cleanText }
}

// ---------------------------------------------------------------------------
// Shared markdown config
// ---------------------------------------------------------------------------

function unwrapTag(children: ReactNode, tag: string): ReactNode {
  return Children.map(children, (child) =>
    isValidElement(child) && child.type === tag
      ? (child.props as { children: ReactNode }).children
      : child
  )
}

const markdownComponents: import("react-markdown").Components = {
  h1: ({ children, node: _n, ...props }) => <h1 {...props}>{unwrapTag(children, "strong")}</h1>,
  h2: ({ children, node: _n, ...props }) => <h2 {...props}>{unwrapTag(children, "strong")}</h2>,
  h3: ({ children, node: _n, ...props }) => <h3 {...props}>{unwrapTag(children, "strong")}</h3>,
  h4: ({ children, node: _n, ...props }) => <h4 {...props}>{unwrapTag(children, "strong")}</h4>,
  li: ({ children, node: _n, ...props }) => (
    <li {...props}>{unwrapTag(children, "p")}</li>
  ),
}

// ---------------------------------------------------------------------------
// Types & context
// ---------------------------------------------------------------------------

// Re-export from pipeline (canonical definition lives there to avoid circular imports)
export type { TranscriptVisibility } from "@/lib/session-pipeline"
export { DEFAULT_TRANSCRIPT_VISIBILITY } from "@/lib/session-pipeline"

const LookupsContext = createContext<MessageLookups>({
  toolResults: new Map(),
  resolvedToolUseIDs: new Set(),
  authorEmails: [],
  fileMap: new Map(),
})
function useLookups() { return useContext(LookupsContext) }

import type { WidgetDef } from "@/types/panels"

type PanelSchemaMap = Record<string, WidgetDef[]>
const PanelSchemasContext = createContext<PanelSchemaMap | undefined>(undefined)
function usePanelSchemas() { return useContext(PanelSchemasContext) }

// ---------------------------------------------------------------------------
// SessionTranscript — pure rendering component
// ---------------------------------------------------------------------------

interface SessionTranscriptProps {
  /** Pre-classified, pre-filtered messages from useSessionController */
  messages: ClassifiedMessage[]
  /** Derived lookups from useSessionController */
  lookups: MessageLookups
  /** User profile map from useSessionController */
  userProfiles: Map<string, { name: string; picture?: string }>
  visibility: TranscriptVisibility
  sessionId?: string
  currentUserEmail?: string
  onOpenPanel?: (spec: OutputSpec, sequence: number) => void
  onAction?: (intent: string) => void
  onAnswer?: (answers: Record<string, string>) => Promise<void>
  onArtifactsReady?: () => void
  children?: ReactNode
}

export function SessionTranscript({
  messages,
  lookups,
  userProfiles,
  visibility,
  sessionId,
  currentUserEmail,
  onOpenPanel,
  onAction,
  onAnswer,
  onArtifactsReady,
  children,
}: SessionTranscriptProps) {
  const { scrollRef, handleScroll } = useTranscriptScroll({
    messageCount: messages.length,
    sessionId,
  })

  // Hoist panel-schemas query here so it's fetched once, not per ContentBlockView
  const { data: panelSchemas } = useQuery({ queryKey: ["panel-schemas"], queryFn: getPanelSchemas, staleTime: 86_400_000 })

  // Track artifact loading
  const expectedArtifacts = useMemo(() => {
    let count = 0
    for (const cm of messages) {
      if (cm.displayType !== "assistant_blocks") continue
      const blocks = getContentBlocks(cm.source.message as AssistantMessage)
      for (const b of blocks) {
        if (b.type !== "tool_use") continue
        if (RENDER_OUTPUT_NAMES.has(b.name) && (b as ToolUseBlock).input?.type === "react") {
          count++
        }
        if (PRESENT_FILES_NAMES.has(b.name) && Array.isArray((b as any).input?.filepaths)) {
          for (const fp of (b as any).input.filepaths as string[]) {
            const ext = fp.split(".").pop()?.toLowerCase()
            if (ext === "jsx" || ext === "tsx") count++
          }
        }
      }
    }
    return count
  }, [messages])

  const artifactsLoadedRef = useRef(0)
  const artifactsReadyFired = useRef(false)
  useEffect(() => {
    artifactsLoadedRef.current = 0
    artifactsReadyFired.current = false
  }, [expectedArtifacts])

  const handleArtifactLoaded = useCallback(() => {
    artifactsLoadedRef.current++
    if (artifactsLoadedRef.current >= expectedArtifacts && !artifactsReadyFired.current) {
      artifactsReadyFired.current = true
      onArtifactsReady?.()
    }
  }, [expectedArtifacts, onArtifactsReady])

  useEffect(() => {
    if (expectedArtifacts === 0 && !artifactsReadyFired.current && messages.length > 0) {
      artifactsReadyFired.current = true
      onArtifactsReady?.()
    }
  }, [expectedArtifacts, messages.length, onArtifactsReady])

  // Virtualizer: only render visible messages + overscan
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 8,
    getItemKey: (i) => messages[i]!.source.sequence,
  })

  // Auto-scroll to bottom when new messages arrive (streaming)
  const prevCountRef = useRef(messages.length)
  useEffect(() => {
    if (messages.length > prevCountRef.current && messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: "end", behavior: "smooth" })
    }
    prevCountRef.current = messages.length
  }, [messages.length, virtualizer])

  return (
    <LookupsContext.Provider value={lookups}>
    <PanelSchemasContext.Provider value={panelSchemas}>
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto overflow-x-hidden overscroll-contain"
        onScroll={handleScroll}
      >
        {messages.length > 0 ? (
          <div
            className="min-w-0"
            style={{
              height: virtualizer.getTotalSize() + 32, // 32px bottom padding
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const cm = messages[virtualRow.index]!
              return (
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
                    padding: "0 16px",
                    paddingTop: virtualRow.index === 0 ? 16 : 6,
                    paddingBottom: 6,
                  }}
                >
                  <TranscriptEntry
                    cm={cm}
                    visibility={visibility}
                    sessionId={sessionId}
                    currentUserEmail={currentUserEmail}
                    userProfiles={userProfiles}
                    onOpenPanel={onOpenPanel}
                    onAction={onAction}
                    onAnswer={onAnswer}
                    onArtifactLoaded={handleArtifactLoaded}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <div className="p-4"><PanelSkeleton /></div>
        )}
        <div className="px-4 pb-4">{children}</div>
      </div>
    </PanelSchemasContext.Provider>
    </LookupsContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// TranscriptEntry — dispatches on pre-computed displayType
// ---------------------------------------------------------------------------

const TranscriptEntry = memo(function TranscriptEntry({
  cm,
  visibility,
  sessionId,
  currentUserEmail,
  userProfiles,
  onOpenPanel,
  onAction,
  onAnswer,
  onArtifactLoaded,
}: {
  cm: ClassifiedMessage
  visibility: TranscriptVisibility
  sessionId?: string
  currentUserEmail?: string
  userProfiles?: Map<string, { name: string; picture?: string }>
  onOpenPanel?: (spec: OutputSpec, sequence: number) => void
  onAction?: (intent: string) => void
  onAnswer?: (answers: Record<string, string>) => Promise<void>
  onArtifactLoaded?: () => void
}) {
  switch (cm.displayType) {
    case "system_attached":
      return (
        <div className="flex items-start gap-2 px-4 py-2 bg-muted/50 rounded-md mx-4 my-1">
          <Paperclip className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-sm">
            <span className="font-medium">{cm.text}</span>
            <span className="text-muted-foreground ml-1">attached</span>
          </div>
        </div>
      )

    case "system_result":
      return (
        <TranscriptAccordionEntry label="Result" color="text-foreground" defaultOpen>
          <div className="prose prose-sm max-w-none dark:prose-invert overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={useRehypeHighlight()} components={markdownComponents}>
              {cm.text}
            </ReactMarkdown>
          </div>
        </TranscriptAccordionEntry>
      )

    case "user_artifact_action":
      return (
        <TranscriptAccordionEntry label="Send action" color="text-muted-foreground" bold={false}>
          <ArtifactActionDetail intent={cm.artifactAction!.intent} dataStr={cm.artifactAction!.data} />
        </TranscriptAccordionEntry>
      )

    case "user_skill":
      return (
        <TranscriptAccordionEntry label={cm.skillBlock!.name} color="text-muted-foreground" bold={false}>
          <div className="prose prose-sm max-w-none dark:prose-invert overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={useRehypeHighlight()} components={markdownComponents}>
              {cm.skillBlock!.content}
            </ReactMarkdown>
          </div>
        </TranscriptAccordionEntry>
      )

    case "user_message": {
      if (!cm.text && cm.ideRefs.length === 0) return null
      const isCurrentUser = !cm.isSubagent && (!cm.authorEmail || cm.authorEmail === currentUserEmail)
      const profile = cm.authorEmail ? userProfiles?.get(cm.authorEmail) : undefined
      const authorLabel = isCurrentUser ? "You" : cm.isSubagent ? cm.agentLabel : (profile?.name || cm.authorName || "User")

      const { attachments: fileAttachments, cleanText } = cm.text
        ? parseAttachments(cm.text)
        : { attachments: [], cleanText: "" }

      if (!cleanText && fileAttachments.length === 0 && cm.ideRefs.length === 0) return null
      return (
        <MessageBubble label={authorLabel} align="right">
          <div className="space-y-1.5">
            {cleanText && <div className="text-sm whitespace-pre-wrap break-words">{cleanText.replace(/\\\n/g, "\n")}</div>}
            {fileAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 justify-end">
                {fileAttachments.map((att, i) => {
                  const ext = att.name.split(".").pop()?.toLowerCase() ?? ""
                  const isImage = IMAGE_EXTS.has(ext)
                  const url = getSessionFileUrl(sessionId || "", att.name, att.path)
                  return (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-1.5 rounded-md border bg-secondary/50 px-2 py-1.5 text-xs max-w-[200px] hover:bg-secondary transition-colors"
                    >
                      {isImage ? (
                        <img src={url} alt={att.name} className="h-8 w-8 rounded object-cover shrink-0" />
                      ) : (
                        <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate text-sm">{att.name}</span>
                    </a>
                  )
                })}
              </div>
            )}
            {cm.ideRefs.length > 0 && (
              <div className="flex flex-wrap gap-1.5 justify-end">
                {cm.ideRefs.map((ref, i) => (
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

    case "assistant_text_only":
      if (!cm.text) return null
      return <MarkdownEntry text={cm.text} label={cm.agentLabel} />

    case "assistant_blocks": {
      const grouped = cm.groupedBlocks!
      return (
        <div className="space-y-1">
          {grouped.map((item, i) => {
            if (Array.isArray(item)) {
              if (!visibility.toolCalls) return null
              return <ToolCallGroup key={i} blocks={item} />
            }
            return (
              <ContentBlockView
                key={i}
                block={item}
                sequence={cm.source.sequence}
                visibility={visibility}
                sessionId={sessionId}
                agentLabel={cm.agentLabel}
                onOpenPanel={onOpenPanel}
                onAction={onAction}
                onAnswer={onAnswer}
                onArtifactLoaded={onArtifactLoaded}
              />
            )
          })}
        </div>
      )
    }

    case "plan": {
      const planTitle = cm.text.match(/^#\s+(.+)/m)?.[1] || "Plan"
      return (
        <OutputAccordion
          spec={{ type: "markdown", data: cm.text, title: planTitle }}
          sessionId={sessionId || ""}
          sequence={cm.source.sequence}
          onOpenPanel={onOpenPanel}
        />
      )
    }

    default:
      return null
  }
})

// ---------------------------------------------------------------------------
// UI components
// ---------------------------------------------------------------------------

function TranscriptAccordionEntry({
  label, color, bold = true, defaultOpen = false, extra, children,
}: {
  label: string; color: string; bold?: boolean; defaultOpen?: boolean; extra?: ReactNode; children?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 py-1.5 w-full">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-left min-w-0">
          <ChevronRight className={`h-3 w-3 shrink-0 transition-transform duration-200 text-muted-foreground ${open ? "rotate-90" : ""}`} />
          <span className={`text-xs ${bold ? "font-medium" : ""} ${color} truncate`}>{label}</span>
        </button>
        {extra}
      </div>
      {open && <div className="pl-[18px]">{children}</div>}
    </div>
  )
}

function MessageBubble({ label, align, transparent, children }: { label: string; align: "left" | "right"; transparent?: boolean; children: ReactNode }) {
  return (
    <div className={`flex flex-col ${align === "right" ? "items-end" : "items-start"}`}>
      <span className="text-xs font-medium text-foreground py-1.5">{label}</span>
      <div className={`rounded-md px-3 py-2 max-w-full min-w-0 ${transparent ? "" : "bg-secondary"}`}>{children}</div>
    </div>
  )
}

function MarkdownEntry({ text, label = "Claude" }: { text: string; label?: string }) {
  return (
    <MessageBubble label={label} align="left" transparent>
      <div className="prose prose-sm max-w-none dark:prose-invert overflow-x-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={useRehypeHighlight()} components={markdownComponents}>{text}</ReactMarkdown>
      </div>
    </MessageBubble>
  )
}

// ---------------------------------------------------------------------------
// AskUser components
// ---------------------------------------------------------------------------

export function parseAskUserAnswer(resultText: string): string[] {
  const match = resultText.match(/"([^"]+)"="([^"]+)"/)
  return match?.[2]?.split(", ").map((s) => s.trim()) ?? []
}

function AskUserQuestionEntry({ questions, resultText, sessionId, sequence, onAnswer }: {
  questions: AskUserQuestion[]; resultText: string; sessionId?: string; sequence: number; onAnswer?: (answers: Record<string, string>) => Promise<void>
}) {
  const { pushPanel, getPanels } = useNavigation()
  const panelId = `ask_user:${sessionId}:${sequence}`
  const isExpandedToPanel = getPanels().some((p) => p.id === panelId)
  const isPending = !resultText && !!onAnswer && !isExpandedToPanel
  const selectedLabels = isPending ? [] : parseAskUserAnswer(resultText)
  const form = useAskUserForm(questions)

  function handleExpand() {
    if (!sessionId) return
    pushPanel({ id: panelId, type: "ask_user", props: { sessionId, sequence, questions, resultText } })
  }

  const topic = questions[0]?.header || questions[0]?.question?.slice(0, 50) || "question"

  return (
    <TranscriptAccordionEntry label={`Ask user about ${topic.toLowerCase()}`} color="text-muted-foreground" bold={false} defaultOpen
      extra={sessionId ? (
        <button type="button" className="p-1 rounded-md hover:bg-secondary text-muted-foreground shrink-0 ml-auto" onClick={(e) => { e.stopPropagation(); handleExpand() }} title="Open in panel">
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      ) : undefined}
    >
      {isPending ? (
        <AskUserForm questions={questions} form={form} onSubmit={() => form.handleSubmit(onAnswer!)} />
      ) : (
        <AskUserOptions questions={questions} selectedLabels={selectedLabels} />
      )}
    </TranscriptAccordionEntry>
  )
}

/** Shared read-only option rendering for AskUserQuestion — used in expanded panels. */
export function AskUserOptions({ questions, selectedLabels }: { questions: AskUserQuestion[]; selectedLabels: string[] }) {
  return (
    <>
      {questions.map((q) => (
        <div key={q.question} className="space-y-1.5">
          <p className="text-sm font-medium">{q.question}</p>
          <div className="space-y-1">
            {q.options?.map((opt) => {
              const isSelected = selectedLabels.includes(opt.label)
              return (
                <div key={opt.label} className={cn("rounded-md border px-3 py-2 text-sm", isSelected ? "border-primary bg-primary/5" : "border-border bg-card opacity-50")}>
                  <div className="flex items-start gap-2">
                    <div className={cn("mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 transition-colors", isSelected ? "border-primary bg-primary" : "border-muted-foreground")} />
                    <div className="min-w-0">
                      <div className="font-medium">{opt.label}</div>
                      {opt.description && <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Output / Artifact components
// ---------------------------------------------------------------------------

function OutputAccordion({ spec, sessionId, sequence, onOpenPanel, onAction, onArtifactLoaded }: {
  spec: OutputSpec; sessionId: string; sequence: number; onOpenPanel?: (spec: OutputSpec, sequence: number) => void; onAction?: (intent: string) => void; onArtifactLoaded?: () => void
}) {
  const [open, setOpen] = useState(true)
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
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
          <ChevronRight className={`h-3 w-3 shrink-0 transition-transform duration-200 text-muted-foreground ${open ? "rotate-90" : ""}`} />
          <span className="text-xs text-muted-foreground truncate">{spec.title || spec.type}</span>
        </button>
        {onOpenPanel && (
          <button type="button" className="p-1 rounded-md hover:bg-secondary text-muted-foreground shrink-0" onClick={() => onOpenPanel(spec, sequence)} title="Open in panel">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="pl-[18px]">
          <OutputRenderer spec={activeSpec} sessionId={sessionId} sequence={sequence} onAction={onAction} onArtifactLoaded={onArtifactLoaded} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tool call components
// ---------------------------------------------------------------------------

const ContentBlockView = memo(function ContentBlockView({ block, sequence, visibility, sessionId, agentLabel = "Claude", onOpenPanel, onAction, onAnswer, onArtifactLoaded }: {
  block: ContentBlockType; sequence: number; visibility: TranscriptVisibility; sessionId?: string; agentLabel?: string
  onOpenPanel?: (spec: OutputSpec, sequence: number) => void; onAction?: (intent: string) => void; onAnswer?: (answers: Record<string, string>) => Promise<void>; onArtifactLoaded?: () => void
}) {
  const lookups = useLookups()
  const panelSchemas = usePanelSchemas()
  const rehypePlugins = useRehypeHighlight()

  if (block.type === "text") {
    if (!block.text || !visibility.messages) return null
    const inboxContextJson = extractXmlTag(block.text, "inbox-context")
    if (inboxContextJson) {
      try {
        const data = JSON.parse(inboxContextJson) as InboxContextData
        const rest = block.text.replace(/<inbox-context>[\s\S]*?<\/inbox-context>/, "").trim()
        return (<><ContextPanel data={data} />{rest && <MarkdownEntry text={rest} label={agentLabel} />}</>)
      } catch { /* fall through */ }
    }
    const inboxResultJson = extractXmlTag(block.text, "inbox-result")
    if (inboxResultJson) {
      try {
        const data = JSON.parse(inboxResultJson) as InboxResultData
        const rest = block.text.replace(/<inbox-result>[\s\S]*?<\/inbox-result>/, "").trim()
        return (<><InboxResultPanel data={data} sessionId={sessionId ?? ""} />{rest && <MarkdownEntry text={rest} label={agentLabel} />}</>)
      } catch { /* fall through */ }
    }
    if (panelSchemas) {
      for (const [tag, widgets] of Object.entries(panelSchemas)) {
        const json = extractXmlTag(block.text, tag)
        if (json) {
          try {
            const data = JSON.parse(json) as Record<string, unknown>
            const rest = block.text.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`), "").trim()
            return (<><div className="rounded-lg border p-3 bg-card"><PanelWidget widgets={widgets} data={data} /></div>{rest && <MarkdownEntry text={rest} label={agentLabel} />}</>)
          } catch { /* fall through */ }
        }
      }
    }
    return <MarkdownEntry text={block.text} label={agentLabel} />
  }

  if (block.type === "tool_use") {
    if (RENDER_OUTPUT_NAMES.has(block.name) && block.input && sessionId) {
      if (!visibility.artifacts) return null
      return <OutputAccordion spec={block.input as OutputSpec} sessionId={sessionId} sequence={sequence} onOpenPanel={onOpenPanel} onAction={onAction} onArtifactLoaded={onArtifactLoaded} />
    }
    // present_files — render artifacts from create_file content
    if (PRESENT_FILES_NAMES.has(block.name) && block.input?.filepaths && sessionId) {
      if (!visibility.artifacts) return null
      const filepaths = block.input.filepaths as string[]
      return (
        <>
          {filepaths.map((fp, idx) => {
            const content = lookups.fileMap.get(fp)
            if (!content) return null
            const spec = fileToOutputSpec(fp, content)
            return (
              <OutputAccordion
                key={`${fp}-${idx}`}
                spec={spec}
                sessionId={sessionId}
                sequence={sequence}
                onOpenPanel={onOpenPanel}
                onAction={onAction}
                onArtifactLoaded={onArtifactLoaded}
              />
            )
          })}
        </>
      )
    }
    // create_file — hidden from transcript (content consumed by present_files)
    if (CREATE_FILE_NAMES.has(block.name)) return null
    // Write tool creating renderable files (HTML, JSX, etc.) — render as artifact
    if (isWriteArtifact(block) && sessionId) {
      if (!visibility.artifacts) return null
      const filePath = block.input!.file_path as string
      const content = lookups.fileMap.get(filePath)
      if (content) {
        const spec = fileToOutputSpec(filePath, content)
        return <OutputAccordion spec={spec} sessionId={sessionId} sequence={sequence} onOpenPanel={onOpenPanel} onAction={onAction} onArtifactLoaded={onArtifactLoaded} />
      }
    }
    if (block.name === "AskUserQuestion" && block.input?.questions) {
      const resultText = lookups.toolResults.get(block.id) ?? ""
      return <AskUserQuestionEntry questions={block.input.questions as AskUserQuestion[]} resultText={resultText} sessionId={sessionId} sequence={sequence} onAnswer={!resultText ? onAnswer : undefined} />
    }
    if (!visibility.toolCalls) return null
    const displayName = TOOL_DISPLAY_NAME[block.name] ?? block.name
    const summary = toolUseSummary(block.name, block.input)
    return (
      <TranscriptAccordionEntry label={summary ? `${displayName} ${summary}` : displayName} color="text-muted-foreground" bold={false}>
        <ToolCallDetail name={block.name} input={block.input} toolUseId={block.id} />
      </TranscriptAccordionEntry>
    )
  }

  if (block.type === "thinking") {
    if (!block.thinking || !visibility.thinking) return null
    return (
      <TranscriptAccordionEntry label="Thinking" color="text-muted-foreground" bold={false} defaultOpen>
        <div className="prose prose-xs max-w-none dark:prose-invert text-muted-foreground overflow-x-auto text-xs [&_code]:text-muted-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={markdownComponents}>{block.thinking}</ReactMarkdown>
        </div>
      </TranscriptAccordionEntry>
    )
  }

  return null
})

function ToolCallGroup({ blocks }: { blocks: ToolUseBlock[] }) {
  const summary = blocks.length === 1 ? toolUseSummary(blocks[0]!.name, blocks[0]!.input) : ""
  const displayName = (name: string) => TOOL_DISPLAY_NAME[name] ?? name
  const label = blocks.length === 1
    ? (summary ? `${displayName(blocks[0]!.name)} ${summary}` : displayName(blocks[0]!.name))
    : blocks.map((b) => displayName(b.name)).join(", ")
  return (
    <TranscriptAccordionEntry label={label} color="text-muted-foreground" bold={false}>
      <div className="space-y-2">
        {blocks.map((block, i) => <ToolCallDetail key={i} name={block.name} input={block.input} toolUseId={block.id} />)}
      </div>
    </TranscriptAccordionEntry>
  )
}

function ArtifactActionDetail({ intent, dataStr }: { intent: string; dataStr: string }) {
  const [showOutput, setShowOutput] = useState(false)
  let payload: string
  try {
    payload = dataStr ? JSON.stringify({ type: "action", intent, data: JSON.parse(dataStr) }, null, 2) : JSON.stringify({ type: "action", intent }, null, 2)
  } catch {
    payload = JSON.stringify({ type: "action", intent, data: dataStr }, null, 2)
  }
  return (
    <div className="border-l-2 border-border pl-3 py-1 min-w-0">
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">SendAction</div>
      <pre className="text-[11px] text-muted-foreground font-mono whitespace-pre">{intent}</pre>
      <button type="button" className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground mt-0.5" onClick={() => setShowOutput((s) => !s)}>
        {showOutput ? "Hide output" : "Show output"}
      </button>
      {showOutput && <pre className="text-[11px] rounded overflow-x-auto max-h-[300px] overflow-y-auto text-muted-foreground font-mono whitespace-pre-wrap break-words mt-1">{payload}</pre>}
    </div>
  )
}

function ToolCallDetail({ name, input, toolUseId }: { name: string; input: Record<string, unknown>; toolUseId?: string }) {
  const lookups = useLookups()
  const [showOutput, setShowOutput] = useState(false)
  const command = toolUseCommand(name, input)
  const resultText = toolUseId ? lookups.toolResults.get(toolUseId) : undefined
  const hasDescription = TOOLS_WITH_DESCRIPTION.has(name)

  return (
    <div className="border-l-2 border-border pl-3 py-1 min-w-0">
      {hasDescription && command && <div className="overflow-x-auto"><pre className="text-[11px] text-muted-foreground font-mono whitespace-pre">{command}</pre></div>}
      {hasDescription && resultText && (
        <>
          <button type="button" className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground mt-0.5" onClick={() => setShowOutput((s) => !s)}>
            {showOutput ? "Hide output" : "Show output"}
          </button>
          {showOutput && <pre className="text-[11px] rounded overflow-x-auto max-h-[300px] overflow-y-auto text-muted-foreground font-mono whitespace-pre-wrap break-words mt-1">{resultText}</pre>}
        </>
      )}
      {!hasDescription && resultText && (
        <pre className="text-[11px] rounded overflow-x-auto max-h-[300px] overflow-y-auto text-muted-foreground font-mono whitespace-pre-wrap break-words mt-1">{resultText}</pre>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// WorkingIndicator (exported for SessionView)
// ---------------------------------------------------------------------------

/** Convert a file path + content into an OutputSpec based on extension. */
function fileToOutputSpec(path: string, content: string): OutputSpec {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  const name = path.split("/").pop() ?? path
  switch (ext) {
    case "jsx": case "tsx":
      return { type: "react", data: { code: content, title: name }, title: name }
    case "html": case "htm":
      return { type: "html", data: content, title: name }
    case "md": case "markdown":
      return { type: "markdown", data: content, title: name }
    case "svg":
      return { type: "html", data: content, title: name }
    case "json":
      try { return { type: "json", data: JSON.parse(content), title: name } }
      catch { return { type: "markdown", data: "```json\n" + content + "\n```", title: name } }
    default:
      return { type: "markdown", data: "```\n" + content + "\n```", title: name }
  }
}

/** Bouncing dots indicator — isolated to avoid re-rendering the transcript on every SSE event.
 *  Dots bounce in a continuous loop while active. On each new event, the currently-bouncing
 *  dot flashes foreground color for one tick, then returns to muted. */
export function WorkingIndicator({ eventCount }: { eventCount: number }) {
  const TICK_MS = 450
  const [tick, setTick] = useState(0)
  const [flash, setFlash] = useState(false)
  const prevCountRef = useRef(eventCount)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (eventCount !== prevCountRef.current) {
      prevCountRef.current = eventCount
      setFlash(true)
    }
  }, [eventCount])

  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(false), TICK_MS)
    return () => clearTimeout(id)
  }, [flash])

  const activeDot = tick % 3
  return (
    <div className="flex justify-center py-4">
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => {
          const isBouncing = activeDot === i
          const color = isBouncing && flash ? "bg-foreground" : "bg-muted-foreground"
          return (
            <span key={isBouncing ? `${i}-${tick}` : i} className={`size-1.5 rounded-full ${color}`}
              style={isBouncing ? { animation: `dot-bounce ${TICK_MS}ms ease-out` } : undefined} />
          )
        })}
      </div>
    </div>
  )
}
