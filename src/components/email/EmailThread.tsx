import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@hammies/frontend/components/ui"
import { Bot, ExternalLink, Ellipsis } from "lucide-react"
import { useEmailThread } from "@/hooks/use-email-thread"
import { formatRelativeDate, formatEmailAddress } from "@/lib/formatters"
import { PanelHeader, BackButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import type { GmailMessage } from "@/types"

interface EmailThreadProps {
  threadId: string
  title?: string
  sessionOpen?: boolean
}

export function EmailThread({ threadId, title, sessionOpen }: EmailThreadProps) {
  const { thread, loading, error } = useEmailThread(threadId)
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!thread || !scrollRef.current) return
    const container = scrollRef.current

    function scrollToLast() {
      const msgs = container.querySelectorAll("[data-message-id]")
      const last = msgs[msgs.length - 1]
      last?.scrollIntoView({ behavior: "instant" })
    }

    scrollToLast()

    let timer: ReturnType<typeof setTimeout>
    const deadline = Date.now() + 2000
    const observer = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        scrollToLast()
        if (Date.now() >= deadline) observer.disconnect()
      }, 50)
    })
    observer.observe(container, { attributes: true, subtree: true, attributeFilter: ["style"] })

    const cleanup = setTimeout(() => observer.disconnect(), 2000)
    return () => {
      clearTimeout(timer)
      clearTimeout(cleanup)
      observer.disconnect()
    }
  }, [thread?.id])

  const header = (
    <PanelHeader
      left={
        <>
          <BackButton onClick={() => navigate("/emails")} />
          <h2 className="font-semibold text-sm truncate">{title}</h2>
        </>
      }
      right={
        <>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="shrink-0 p-1.5 rounded-md hover:bg-accent text-muted-foreground"
                />
              }
            >
              <Ellipsis className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem
                render={
                  <a
                    href={`https://mail.google.com/mail/u/0/#inbox/${threadId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                <ExternalLink className="h-4 w-4" />
                Open in Gmail
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {!sessionOpen && (
            <Button onClick={() => navigate(`/emails/${threadId}/session/new`)} size="sm">
              <Bot className="h-4 w-4 md:mr-1" />
              <span className="hidden md:inline">Start Session</span>
            </Button>
          )}
        </>
      }
    />
  )

  if (loading || !thread) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <PanelSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="p-6 text-destructive">Error loading thread: {error}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {header}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {thread.messages.map((message, i) => {
          const isLast = i === thread.messages.length - 1
          return (
            <div key={message.id} data-message-id={message.id} className="border-b">
              <Accordion defaultValue={isLast ? [`msg-${message.id}`] : []}>
                <AccordionItem value={`msg-${message.id}`} className="border-0">
                  <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-accent/50">
                    <div className="flex items-center justify-between w-full gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">
                        {formatEmailAddress(message.from)}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                        {formatRelativeDate(message.date)}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-0">
                    <EmailMessage message={message} />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HtmlBody({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const style = getComputedStyle(document.documentElement)
  const fg = style.getPropertyValue("--foreground").trim() || "inherit"
  const bg = "transparent"
  const font =
    style.getPropertyValue("--font-sans").trim() ||
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; color: ${fg} !important; font-family: ${font} !important; font-size: 13px !important; line-height: 1.5 !important; background: none !important; }
    html, body { margin: 0; padding: 0; overflow: hidden; background: ${bg} !important; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background-color: rgba(255,255,255,0.12); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background-color: rgba(255,255,255,0.2); }
    blockquote, .gmail_quote, .gmail_extra, [class*="quote"] { display: none !important; }
    img { max-width: 100%; height: auto; }
    a { color: ${fg} !important; opacity: 0.7; word-break: break-all; }
    pre, code { white-space: pre-wrap !important; font-family: monospace !important; }
    table { max-width: 100%; border-collapse: collapse; }
    td, th { padding: 2px 4px; }
    h1, h2, h3, h4, h5, h6 { font-size: 13px !important; font-weight: 600 !important; margin: 0.5em 0 !important; }
    p { margin: 0.25em 0 !important; }
  </style></head><body>${html}</body></html>`

  // Size the iframe from the parent using allow-same-origin DOM access (no scripts needed)
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    function syncHeight() {
      const body = iframe!.contentDocument?.body
      if (body) iframe!.style.height = body.scrollHeight + "px"
    }

    iframe.addEventListener("load", syncHeight)

    let ro: ResizeObserver | undefined
    function onLoad() {
      syncHeight()
      const body = iframe!.contentDocument?.body
      if (body) {
        ro = new ResizeObserver(syncHeight)
        ro.observe(body)
      }
    }
    iframe.addEventListener("load", onLoad)

    return () => {
      iframe.removeEventListener("load", syncHeight)
      iframe.removeEventListener("load", onLoad)
      ro?.disconnect()
    }
  }, [srcDoc])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups"
      className="w-full border-0 overflow-hidden"
      style={{ height: 0 }}
    />
  )
}

function EmailMessage({ message }: { message: GmailMessage }) {
  return (
    <div className="px-4 pb-4 space-y-3 selectable-content">
      <div className="text-xs text-muted-foreground">to {formatEmailAddress(message.to)}</div>
      {message.bodyIsHtml ? (
        <HtmlBody html={message.body} />
      ) : (
        <div className="text-sm whitespace-pre-wrap leading-relaxed">{message.body}</div>
      )}
    </div>
  )
}
