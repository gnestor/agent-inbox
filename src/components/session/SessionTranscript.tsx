import { useRef, useEffect } from "react"
import { User, Bot, Wrench, Brain, Loader2 } from "lucide-react"
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

  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

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
        <div className="space-y-1">
        {messages.map((msg) => (
          <TranscriptEntry key={msg.sequence} message={msg} />
        ))}
        {isStreaming && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Agent is working...</span>
          </div>
        )}
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center p-8 text-muted-foreground">
            <p className="text-sm">No messages yet</p>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

function TranscriptEntry({ message }: { message: SessionMessage }) {
  const msg = message.message as any

  if (msg.type === "system") {
    if (msg.subtype === "init") return null
    if (msg.subtype === "result" || "result" in msg) {
      return (
        <Accordion defaultValue={[`result-${message.sequence}`]}>
          <AccordionItem value={`result-${message.sequence}`} className="border-0 min-w-0">
            <AccordionTrigger className="py-2 hover:no-underline">
              <div className="flex items-center gap-2">
                <Bot className="h-3.5 w-3.5 text-chart-1 shrink-0" />
                <span className="text-xs font-medium text-chart-1">Result</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="text-sm prose prose-sm max-w-none dark:prose-invert pl-5.5 overflow-x-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {msg.result || "Session completed"}
                </ReactMarkdown>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )
    }
    return null
  }

  if (msg.type === "user" || msg.role === "user") {
    const text = extractText(msg)
    if (!text) return null
    return (
      <Accordion defaultValue={[`user-${message.sequence}`]}>
        <AccordionItem value={`user-${message.sequence}`} className="border-0 min-w-0">
          <AccordionTrigger className="py-2 hover:no-underline">
            <div className="flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-chart-2 shrink-0" />
              <span className="text-xs font-medium text-chart-2">You</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="text-sm whitespace-pre-wrap break-words pl-5.5">{text}</div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    )
  }

  if (msg.type === "assistant" || msg.role === "assistant") {
    const contentBlocks = msg.content || msg.message?.content || []
    if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) {
      const text = extractText(msg)
      if (!text) return null
      return (
        <Accordion defaultValue={[`assistant-${message.sequence}`]}>
          <AccordionItem value={`assistant-${message.sequence}`} className="border-0 min-w-0">
            <AccordionTrigger className="py-2 hover:no-underline">
              <div className="flex items-center gap-2">
                <Bot className="h-3.5 w-3.5 text-chart-4 shrink-0" />
                <span className="text-xs font-medium text-chart-4">Claude</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="text-sm prose prose-sm max-w-none dark:prose-invert pl-5.5 overflow-x-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{text}</ReactMarkdown>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
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
}

function ContentBlock({ block, sequence, index }: { block: any; sequence: number; index: number }) {
  const id = `${sequence}-${index}`

  if (block.type === "text") {
    if (!block.text) return null
    return (
      <Accordion defaultValue={[`text-${id}`]}>
        <AccordionItem value={`text-${id}`} className="border-0 min-w-0">
          <AccordionTrigger className="py-2 hover:no-underline">
            <div className="flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 text-chart-4 shrink-0" />
              <span className="text-xs font-medium text-chart-4">Claude</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="text-sm prose prose-sm max-w-none dark:prose-invert pl-5.5 overflow-x-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{block.text}</ReactMarkdown>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    )
  }

  if (block.type === "tool_use") {
    const summary = toolUseSummary(block.name, block.input)
    return (
      <Accordion>
        <AccordionItem value={`tool-${id}`} className="border-0 min-w-0">
          <AccordionTrigger className="py-2 hover:no-underline">
            <div className="flex items-center gap-2 min-w-0">
              <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-muted-foreground">{block.name}</span>
              {summary && (
                <span className="text-xs text-muted-foreground truncate">
                  {summary}
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            {block.input && (
              <HighlightedJson data={block.input} className="pl-5.5" />
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    )
  }

  if (block.type === "thinking") {
    if (!block.thinking) return null
    return (
      <Accordion>
        <AccordionItem value={`thinking-${id}`} className="border-0 min-w-0">
          <AccordionTrigger className="py-2 hover:no-underline">
            <div className="flex items-center gap-2">
              <Brain className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-xs font-medium text-primary">Thinking</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words pl-5.5">
              {block.thinking}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    )
  }

  return null
}

function HighlightedJson({ data, className }: { data: any; className?: string }) {
  // hljs.highlight only produces <span class="hljs-*"> tags — safe to use with dangerouslySetInnerHTML
  const html = hljs.highlight(JSON.stringify(data, null, 2), { language: "json" }).value
  return (
    <pre className={`text-[11px] rounded overflow-x-auto max-h-[300px] overflow-y-auto ${className || ""}`}>
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}

function toolUseSummary(name: string, input: any): string {
  if (!input) return ""
  switch (name) {
    case "Read": return input.file_path || ""
    case "Write": return input.file_path || ""
    case "Edit": return input.file_path || ""
    case "Bash": return input.description || (typeof input.command === "string" ? input.command.slice(0, 60) : "")
    case "Glob": return input.pattern || ""
    case "Grep": return input.pattern || ""
    case "WebFetch": return input.url || ""
    case "WebSearch": return input.query || ""
    default: return ""
  }
}

function extractText(msg: any): string {
  if (typeof msg.content === "string") return msg.content
  if (typeof msg.text === "string") return msg.text
  if (msg.message?.content) {
    if (typeof msg.message.content === "string") return msg.message.content
    if (Array.isArray(msg.message.content)) {
      return msg.message.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
    }
  }
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
  }
  return ""
}
