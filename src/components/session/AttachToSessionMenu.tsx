import { useState } from "react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@hammies/frontend/components/ui"
import { Plus } from "lucide-react"
import { useSessions } from "@/hooks/use-sessions"
import { useAttachToSession } from "@/hooks/use-session-mutation"
import { truncate } from "@/lib/formatters"

interface AttachToSessionMenuProps {
  source: { type: string; id: string; title: string; content: string }
}

export function AttachToSessionMenu({ source }: AttachToSessionMenuProps) {
  const [open, setOpen] = useState(false)
  const { sessions } = useSessions(undefined, open)
  const attachMutation = useAttachToSession()

  function handleSelect(sessionId: string) {
    attachMutation.mutate({ sessionId, source })
    setOpen(false)
  }

  const recentSessions = sessions.slice(0, 10)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Plus className="h-3 w-3" />
        Add to session
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Add to session</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recentSessions.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No sessions</div>
        )}
        {recentSessions.map((session) => (
          <DropdownMenuItem
            key={session.id}
            onSelect={() => handleSelect(session.id)}
          >
            <span className="truncate">
              {session.summary || truncate(session.prompt, 50)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
