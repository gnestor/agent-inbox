import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@hammies/frontend/components/ui"
import { cn } from "@hammies/frontend/lib/utils"
import { useSessions } from "@/hooks/use-sessions"
import type { Session } from "@/types"

const ONE_DAY_MS = 86_400_000

function isRecentSession(session: Session): boolean {
  if (session.status === "running" || session.status === "awaiting_user_input") return true
  const ref = session.completedAt ?? session.updatedAt
  return Date.now() - new Date(ref).getTime() < ONE_DAY_MS
}

function getIndicatorColor(session: Session, isRead: boolean): string {
  if (session.status === "running") return "#EAB308"
  if (session.status === "awaiting_user_input" || session.status === "errored") return "#EF4444"
  return isRead ? "#9CA3AF" : "#22C55E"
}

function getSessionTitle(session: Session): string {
  if (session.linkedItemTitle) return session.linkedItemTitle
  if (session.summary) return session.summary
  return session.prompt.length > 60 ? session.prompt.slice(0, 60) + "…" : session.prompt
}

function getSessionUrl(session: Session): string {
  if (session.linkedEmailThreadId) {
    return `/emails/${encodeURIComponent(session.linkedEmailThreadId)}/session/${session.id}`
  }
  if (session.linkedTaskId) {
    return `/tasks/${encodeURIComponent(session.linkedTaskId)}/session/${session.id}`
  }
  return `/sessions/${session.id}`
}

// Extract the active session ID from the current URL:
//   /emails/{id}/session/{sessionId}  →  sessionId
//   /tasks/{id}/session/{sessionId}   →  sessionId
//   /sessions/{sessionId}             →  sessionId
function activeSessionIdFromPath(pathname: string): string | null {
  const overlayMatch = pathname.match(/^\/(emails|tasks)\/[^/]+\/session\/(.+)/)
  if (overlayMatch) return decodeURIComponent(overlayMatch[2])
  const sessionMatch = pathname.match(/^\/sessions\/(.+)/)
  if (sessionMatch) return decodeURIComponent(sessionMatch[1])
  return null
}

function loadReadSet(): Set<string> {
  try {
    const raw = localStorage.getItem("inbox:sessions-read")
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

export function markSessionRead(sessionId: string): void {
  try {
    const set = loadReadSet()
    set.add(sessionId)
    localStorage.setItem("inbox:sessions-read", JSON.stringify([...set]))
  } catch {
    // ignore
  }
}

export function SidebarRecentSessions() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isMobile, setOpenMobile } = useSidebar()
  const { sessions, refresh } = useSessions()

  const recent = sessions.filter(isRecentSession).slice(0, 10)
  const hasActive = recent.some(
    (s) => s.status === "running" || s.status === "awaiting_user_input",
  )

  // Poll every 5s while there are active sessions
  useEffect(() => {
    if (!hasActive) return
    const id = setInterval(refresh, 5_000)
    return () => clearInterval(id)
  }, [hasActive, refresh])

  if (recent.length === 0) return null

  const readSet = loadReadSet()
  const isFromSidebar = !!(location.state as { fromSidebar?: boolean } | null)?.fromSidebar
  const activeSessionId = activeSessionIdFromPath(location.pathname)

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Recent</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {recent.map((session) => {
            const isRead = readSet.has(session.id)
            const color = getIndicatorColor(session, isRead)
            const title = getSessionTitle(session)
            const url = getSessionUrl(session)
            const isActive = isFromSidebar && session.id === activeSessionId

            return (
              <SidebarMenuItem key={session.id}>
                <SidebarMenuButton
                  isActive={isActive}
                  tooltip={title}
                  onClick={() => {
                    markSessionRead(session.id)
                    navigate(url, { state: { fromSidebar: true, title } })
                    if (isMobile) setOpenMobile(false)
                  }}
                  className={cn("gap-2", isActive && "bg-accent text-accent-foreground font-medium")}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  <span className="truncate text-sm">{title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
