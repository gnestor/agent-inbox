import { useEffect, useRef } from "react"
import { useIframeAutoHeight } from "@/hooks/use-iframe-auto-height"
import { useLocation } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { getLinkedSession } from "@/api/client"
import {
  Button,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@hammies/frontend/components/ui"
import {
  ExternalLink,
  Archive,
  Trash2,
  Star,
  Milestone,
  Pencil,
  Send,
  Save,
} from "lucide-react"
import { SessionActionMenu } from "@/components/session/AttachToSessionMenu"
import { useEmailThread } from "@/hooks/use-email-thread"
import { useEmailActions } from "@/hooks/use-email-actions"
import { useEmailDraft } from "@/hooks/use-email-draft"
import { formatRelativeDate, formatEmailAddress, formatFileSize } from "@/lib/formatters"
import { PanelHeader, BackButton, SidebarButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { RichTextEditor } from "@/components/shared/RichTextEditor"
import { useNavigation } from "@/hooks/use-navigation"
import type { GmailMessage } from "@/types"

interface EmailThreadProps {
  threadId: string
  title?: string
  sessionOpen?: boolean
}

export function EmailThread({ threadId, title, sessionOpen }: EmailThreadProps) {
  const { thread, loading, error } = useEmailThread(threadId)
  const { deselectItem } = useNavigation()
  const location = useLocation()
  const isFromSidebar = !!(location.state as { fromSidebar?: boolean } | null)?.fromSidebar
  const { data: linkedData } = useQuery({
    queryKey: ["linked-session", "thread", threadId],
    queryFn: () => getLinkedSession(threadId),
  })
  const linkedSession = linkedData?.session
  const scrollRef = useRef<HTMLDivElement>(null)
  const actions = useEmailActions(threadId, thread, {
    onRemove: () => deselectItem(),
  })

  const draft = useEmailDraft(threadId, thread)

  // Scroll to bottom when thread loads, and keep scrolling as iframes resize
  useEffect(() => {
    if (!thread || !scrollRef.current) return
    const container = scrollRef.current

    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight
    })

    const ro = new ResizeObserver(() => {
      container.scrollTop = container.scrollHeight
    })
    for (const child of container.children) {
      ro.observe(child)
    }

    return () => ro.disconnect()
  }, [thread?.id])

  const header = (
    <PanelHeader
      left={
        <>
          {isFromSidebar ? <SidebarButton /> : <BackButton onClick={() => deselectItem()} />}
          <h2 className="font-semibold text-sm truncate">{title ?? thread?.subject}</h2>
        </>
      }
      right={
        <>
          <button
            type="button"
            onClick={actions.archive}
            className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
            title="Archive"
          >
            <Archive className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={actions.trash}
            className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={actions.toggleStar}
            className={`shrink-0 p-1.5 rounded-md hover:bg-secondary ${actions.isStarred ? "text-yellow-500" : "text-muted-foreground"}`}
            title={actions.isStarred ? "Unstar" : "Star"}
          >
            <Star className="h-4 w-4" fill={actions.isStarred ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            onClick={actions.toggleImportant}
            className={`shrink-0 p-1.5 rounded-md hover:bg-secondary ${actions.isImportant ? "text-yellow-500" : "text-muted-foreground"}`}
            title={actions.isImportant ? "Mark not important" : "Mark important"}
          >
            <Milestone className="h-4 w-4" fill={actions.isImportant ? "currentColor" : "none"} />
          </button>
          <a
            href={`https://mail.google.com/mail/u/0/#inbox/${threadId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
            title="Open in Gmail"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          {thread && (
            <SessionActionMenu
              source={{
                type: "email",
                id: threadId,
                title: thread.subject,
                content: `Email thread: ${thread.subject}\n\nFrom: ${thread.messages[0]?.from}\n\n${thread.messages.map((m) => m.snippet).join("\n---\n")}`,
              }}
              linkedSessionId={linkedSession?.id}
              hidden={sessionOpen}
            />
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
    const isConnectionError = error.includes("Google account not connected")
    return (
      <div className="flex flex-col h-full">
        {header}
        {isConnectionError ? (
          <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground">
            <p className="text-sm font-medium mb-1">Google account not connected</p>
            <p className="text-xs">Connect your Google account in Integrations to view this thread.</p>
          </div>
        ) : (
          <div className="p-6 text-destructive text-sm">Error loading thread: {error}</div>
        )}
      </div>
    )
  }

  const sentMessages = thread.messages.filter((m) => !m.labelIds.includes("DRAFT"))
  const lastMessage = sentMessages[sentMessages.length - 1] ?? thread.messages[0]
  const replyTo = lastMessage.from

  return (
    <div className="flex flex-col h-full">
      {header}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {sentMessages.map((message, i) => {
          const isLast = i === sentMessages.length - 1
          return (
            <div key={message.id} data-message-id={message.id} className="border-b">
              <Accordion defaultValue={isLast ? [`msg-${message.id}`] : []}>
                <AccordionItem value={`msg-${message.id}`} className="border-0">
                  <AccordionTrigger className="px-[15px] py-3 mx-px hover:no-underline hover:bg-secondary">
                    <div className="flex items-center justify-between w-full gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">
                        {formatEmailAddress(message.from)}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 px-2">
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

        {/* Draft reply accordion */}
        <div className="border-b">
          <Accordion key={threadId} defaultValue={draft.body || draft.hasGmailDraft ? ["draft-reply"] : []}>
            <AccordionItem value="draft-reply" className="border-0">
              <AccordionTrigger className="px-[15px] py-3 mx-px hover:no-underline hover:bg-secondary">
                <div className="flex items-center gap-2 w-full min-w-0">
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium text-muted-foreground truncate">
                    Draft reply
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-0">
                <div className="px-4 py-3 pb-4 space-y-4">
                  <div className="text-xs text-muted-foreground truncate">
                    To: {formatEmailAddress(replyTo)}
                  </div>
                  <RichTextEditor
                    key={threadId}
                    value={draft.body}
                    onChange={draft.setBody}
                    placeholder="Write your reply..."
                    disabled={draft.phase !== "idle"}
                    onCmdEnter={draft.send}
                  />
                  <div className="flex items-center gap-4 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={draft.save}
                      disabled={!draft.canSubmit}
                    >
                      <Save className="h-3.5 w-3.5 mr-1" />
                      Save Draft
                    </Button>
                    <Button
                      size="sm"
                      onClick={draft.send}
                      disabled={!draft.canSubmit}
                    >
                      <Send className="h-3.5 w-3.5 mr-1" />
                      Send
                    </Button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    </div>
  )
}


function HtmlBody({ html }: { html: string }) {
  const sanitizedHtml = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/\s+style="[^"]*"/gi, "")

  // Use CSS variables (synced live from parent) instead of baked-in values
  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>
    *, *::before, *::after { box-sizing: border-box; background: none !important; }
    html, body { margin: 0; padding: 0; overflow: hidden; background: var(--card, transparent) !important; color: var(--foreground, inherit); font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif); font-size: 14px; line-height: 1.625; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background-color: rgba(255,255,255,0.12); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background-color: rgba(255,255,255,0.2); }
    blockquote, .gmail_quote, .gmail_extra, [class*="quote"] { display: none !important; }
    img { max-width: 100%; height: auto; }
    a { color: var(--foreground, inherit) !important; opacity: 0.7; word-break: break-all; }
    pre, code { white-space: pre-wrap !important; font-family: var(--font-mono, monospace) !important; }
    table, thead, tbody, tr, th, td { border: none !important; }
    table { max-width: 100%; border-collapse: collapse; width: 100%; table-layout: auto; text-align: left; margin: 1em 0; }
    thead { border-bottom: 1px solid color-mix(in srgb, var(--foreground) 20%, transparent) !important; }
    tbody tr { border-bottom: 1px solid color-mix(in srgb, var(--foreground) 10%, transparent) !important; }
    th { font-weight: 600; padding: 0.5em 0.75em; vertical-align: bottom; }
    td { padding: 0.5em 0.75em; vertical-align: top; }
    p { margin: 0.25em 0; }
    div + div { margin-top: 0.5em; }
    h1, h2, h3, h4, h5, h6 { font-size: 14px !important; font-weight: 600 !important; margin: 0.5em 0 !important; }
  </style></head><body>${sanitizedHtml}</body></html>`

  const { iframeRef } = useIframeAutoHeight(srcDoc)

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
    <div className="px-4 py-3 pb-4 space-y-3 selectable-content">
      <div className="text-xs text-muted-foreground">to {formatEmailAddress(message.to)}</div>
      {message.bodyIsHtml ? (
        <HtmlBody html={message.body} />
      ) : (
        <div className="text-sm whitespace-pre-wrap leading-relaxed">{message.body}</div>
      )}
      {message.attachments?.length > 0 && (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left px-3 py-1.5 font-medium">File</th>
                <th className="text-right px-3 py-1.5 font-medium">Size</th>
              </tr>
            </thead>
            <tbody>
              {message.attachments.map((att) => (
                <tr key={att.attachmentId} className="border-t">
                  <td className="px-3 py-1.5">
                    <a
                      href={`/api/gmail/messages/${message.id}/attachments/${encodeURIComponent(att.attachmentId)}?filename=${encodeURIComponent(att.filename)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {att.filename}
                    </a>
                  </td>
                  <td className="text-right px-3 py-1.5 text-muted-foreground">
                    {formatFileSize(att.size)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
