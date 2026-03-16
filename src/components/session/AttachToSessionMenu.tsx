import { useState, useDeferredValue } from "react"
import { useNavigation } from "@/hooks/use-navigation"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@hammies/frontend/components/ui"
import { Sparkles, Search } from "lucide-react"
import { useSessions } from "@/hooks/use-sessions"
import { useAttachToSession } from "@/hooks/use-session-mutation"
import { truncate } from "@/lib/formatters"

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
  const { openSession } = useNavigation()
  const filters = deferredSearch ? { q: deferredSearch } : undefined
  const { sessions } = useSessions(filters, open)
  const attachMutation = useAttachToSession()

  if (hidden) return null

  function handleAttach(sessionId: string) {
    attachMutation.mutate({ sessionId, source })
    setOpen(false)
    setSearch("")
  }

  const recentSessions = sessions.slice(0, 10)

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) setSearch("")
      }}
    >
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={`shrink-0 p-1.5 rounded-md hover:bg-accent ${linkedSessionId ? "text-chart-4" : "text-muted-foreground"}`}
            title="Session actions"
          />
        }
      >
        <Sparkles className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              openSession(linkedSessionId)
            }}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            {linkedSessionId ? "Open session" : "New session"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Add to existing session</DropdownMenuLabel>
          <div className="px-2 pb-1.5">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-background">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
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
                onSelect={() => handleAttach(session.id)}
              >
                <span className="truncate">
                  {session.summary || truncate(session.prompt, 50)}
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Re-export for backwards compat
export { SessionActionMenu as AttachToSessionMenu }
