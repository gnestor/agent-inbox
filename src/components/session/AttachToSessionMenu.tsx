import { useState, useDeferredValue, useRef } from "react"
import { useNavActions } from "@/lib/navigation-store"
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@hammies/frontend/components/ui"
import { Sparkles, Search } from "lucide-react"
import { useSessions } from "@/hooks/use-sessions"
import { useAttachToSession } from "@/hooks/use-session-mutation"

interface SessionActionMenuProps {
  /** Source context to attach when selecting an existing session */
  source: { type: string; id: string; title: string; content: string }
  /** Session ID of linked session (if one exists) */
  linkedSessionId?: string
  /** Whether the session panel is already open (hides the button) */
  hidden?: boolean
}

export function SessionActionMenu({
  source,
  linkedSessionId,
  hidden,
}: SessionActionMenuProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)
  const { openSession, openNewSession } = useNavActions()
  const filters = deferredSearch ? { q: deferredSearch } : undefined
  const { sessions } = useSessions(filters, { enabled: open })
  const attachMutation = useAttachToSession()
  const searchInputRef = useRef<HTMLInputElement>(null)

  if (hidden) return null

  function handleAttach(sessionId: string) {
    attachMutation.mutate({ sessionId, source })
    setOpen(false)
    setSearch("")
    openSession(sessionId)
  }

  // Show every unarchived session (scrollable), no arbitrary cap — same as the
  // Sessions list. A search hits ALL sessions server-side (the /sessions q= path
  // runs searchAgentSessions over every JSONL).
  const recentSessions = sessions.filter((s) => s.summary && s.status !== "archived")

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) {
          // Delay to let Base UI finish its focus management
          setTimeout(() => searchInputRef.current?.focus(), 0)
        } else {
          setSearch("")
        }
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={linkedSessionId ? "text-chart-4" : "text-muted-foreground"}
            title="Session actions"
          />
        }
      >
        <Sparkles className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem
          onClick={() => {
            setOpen(false)
            if (linkedSessionId) {
              openSession(linkedSessionId)
            } else {
              openNewSession({ type: source.type, id: source.id, content: source.content })
            }
          }}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          {linkedSessionId ? "Open session" : "New session"}
        </DropdownMenuItem>
        {linkedSessionId && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              openNewSession({ type: source.type, id: source.id, content: source.content })
            }}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            New session
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Add to existing session</div>
        <div className="px-2 pb-1.5">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-card">
            <Search className="h-3 w-3 text-muted-foreground shrink-0" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sessions..."
              className="text-sm bg-transparent outline-none w-full placeholder:text-muted-foreground"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
        </div>
        <div className="max-h-48 overflow-y-auto">
          {recentSessions.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {search ? "No matching sessions" : "No sessions"}
            </div>
          )}
          {recentSessions.map((session) => (
            <DropdownMenuItem
              key={session.id}
              onClick={() => handleAttach(session.id)}
            >
              <span className="truncate">{session.summary}</span>
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Re-export for backwards compat
export { SessionActionMenu as AttachToSessionMenu }
