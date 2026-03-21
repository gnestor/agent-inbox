import { useMemo } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useQueries } from "@tanstack/react-query"
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
import { getEmailThread, getTask } from "@/api/client"
import { useSessions } from "@/hooks/use-sessions"
import type { Session } from "@/types"

const ONE_DAY_MS = 86_400_000

export function isRecentSession(session: Session): boolean {
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

export function getSessionUrl(session: Session): string {
  if (session.linkedEmailThreadId) {
    return `/recent/emails/${encodeURIComponent(session.linkedEmailThreadId)}/session/${session.id}`
  }
  if (session.linkedTaskId) {
    return `/recent/tasks/${encodeURIComponent(session.linkedTaskId)}/session/${session.id}`
  }
  return `/recent/sessions/${session.id}`
}

// Extract the active session ID from the current URL:
//   /recent/emails/{id}/session/{sessionId}  →  sessionId
//   /recent/tasks/{id}/session/{sessionId}   →  sessionId
//   /recent/sessions/{sessionId}             →  sessionId
function activeSessionIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/recent\/(emails|tasks)\/[^/]+\/session\/([^/]+)/)
  if (m) return decodeURIComponent(m[2])
  const m2 = pathname.match(/^\/recent\/sessions\/([^/]+)/)
  if (m2) return decodeURIComponent(m2[1])
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
  const { sessions } = useSessions(undefined, { refetchInterval: 5_000 })

  const recent = sessions.filter(isRecentSession).slice(0, 10)

  // Collect linked IDs that need title lookups (no linkedItemTitle yet)
  const linkedEmailIds = useMemo(
    () =>
      [...new Set(recent.filter((s) => s.linkedEmailThreadId && !s.linkedItemTitle).map((s) => s.linkedEmailThreadId!))],
    [recent],
  )
  const linkedTaskIds = useMemo(
    () =>
      [...new Set(recent.filter((s) => s.linkedTaskId && !s.linkedItemTitle).map((s) => s.linkedTaskId!))],
    [recent],
  )

  // Fetch email subjects and task titles in parallel
  const emailQueries = useQueries({
    queries: linkedEmailIds.map((threadId) => ({
      queryKey: ["gmail-thread", threadId],
      queryFn: () => getEmailThread(threadId),
      staleTime: 5 * 60 * 1000,
    })),
  })
  const taskQueries = useQueries({
    queries: linkedTaskIds.map((taskId) => ({
      queryKey: ["task", taskId],
      queryFn: () => getTask(taskId),
      staleTime: 5 * 60 * 1000,
    })),
  })

  // Build lookup maps: linkedId → title
  // Derive stable dep keys from query data (not the query arrays themselves, which are new each render)
  const emailSubjects = emailQueries.map((q) => q.data?.subject ?? "")
  const taskTitles = taskQueries.map((q) => q.data?.title ?? "")
  const titleLookup = useMemo(() => {
    const map = new Map<string, string>()
    linkedEmailIds.forEach((id, i) => {
      if (emailSubjects[i]) map.set(id, emailSubjects[i])
    })
    linkedTaskIds.forEach((id, i) => {
      if (taskTitles[i]) map.set(id, taskTitles[i])
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedEmailIds, linkedTaskIds, emailSubjects.join("\0"), taskTitles.join("\0")])



  // eslint-disable-next-line react-hooks/exhaustive-deps
  const readSet = useMemo(() => loadReadSet(), [recent])
  const isRecentRoute = location.pathname.startsWith("/recent/")
  const activeSessionId = activeSessionIdFromPath(location.pathname)
  const isSessionsTab = !isRecentRoute && location.pathname.startsWith("/sessions")

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Sessions</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {recent.map((session) => {
            const isRead = readSet.has(session.id)
            const color = getIndicatorColor(session, isRead)
            const linkedTitle = titleLookup.get(session.linkedEmailThreadId ?? session.linkedTaskId ?? "")
            const title = linkedTitle || getSessionTitle(session)
            const isActive = isRecentRoute && session.id === activeSessionId

            return (
              <SidebarMenuItem key={session.id}>
                <SidebarMenuButton
                  tooltip={title}
                  onClick={() => {
                    markSessionRead(session.id)
                    navigate(getSessionUrl(session))
                    if (isMobile) setOpenMobile(false)
                  }}
                  className={cn(
                    "gap-2",
                    isActive
                      ? "bg-primary text-primary-foreground font-medium hover:bg-primary hover:text-primary-foreground active:bg-primary active:text-primary-foreground"
                      : "hover:bg-secondary hover:text-foreground active:bg-secondary active:text-foreground",
                  )}
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
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="All Sessions"
              className={cn(
                isSessionsTab
                  ? "bg-primary text-primary-foreground font-medium hover:bg-primary hover:text-primary-foreground active:bg-primary active:text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground active:bg-secondary active:text-foreground",
              )}
              onClick={() => {
                navigate("/sessions")
                if (isMobile) setOpenMobile(false)
              }}
            >
              <span>•••</span>
              <span>All Sessions</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
