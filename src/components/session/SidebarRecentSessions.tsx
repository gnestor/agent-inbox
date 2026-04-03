import { useMemo } from "react"
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
import { getPluginItem } from "@/api/client"
import { getItemTitle } from "@/lib/formatters"
import { useWorkspaceId } from "@/hooks/use-user"
import { useSessions } from "@/hooks/use-sessions"
import { useActiveTab, useNavActions } from "@/lib/navigation-store"
import type { Session } from "@/types"
import type { TabId } from "@/types/navigation"
import { ACTIVE_TAB_CLASSES } from "@/lib/navigation-constants"

const ONE_DAY_MS = 86_400_000

export function isRecentSession(session: Session): boolean {
  if (session.status === "archived") return false
  if (session.status === "running" || session.status === "awaiting_user_input") return true
  const ref = session.completedAt ?? session.updatedAt
  return Date.now() - new Date(ref).getTime() < ONE_DAY_MS
}

const IDLE_MS = 30 * 60 * 1000

function getIndicatorColor(session: Session): string {
  if (session.status === "running") return "#EAB308"
  if (session.status === "errored") return "#EF4444"
  if (session.status === "awaiting_user_input") return "#3B82F6"
  const lastActivity = new Date(session.completedAt ?? session.updatedAt).getTime()
  return Date.now() - lastActivity > IDLE_MS ? "#9CA3AF" : "#22C55E"
}

function getSessionTitle(session: Session): string {
  if (session.summary) return session.summary
  return session.prompt.length > 60 ? session.prompt.slice(0, 60) + "…" : session.prompt
}

export function getSessionUrl(session: Session): string {
  const sourceType = session.linkedSourceType
  const sourceId = session.linkedSourceId
  if (sourceType && sourceId) {
    return `/recent/${sourceType}/${encodeURIComponent(sourceId)}/session/${session.id}`
  }
  return `/recent/sessions/${session.id}`
}



export function SidebarRecentSessions() {
  const { openRecent, switchTab } = useNavActions()
  const activeTab = useActiveTab()
  const { isMobile, setOpenMobile } = useSidebar()
  const wsId = useWorkspaceId()
  const { sessions } = useSessions(undefined, { refetchInterval: 5_000 })

  const recent = sessions.filter(isRecentSession).slice(0, 10)

  // Collect linked items that need title lookups (no linkedItemTitle yet)
  const linkedItems = useMemo(
    () => {
      const seen = new Set<string>()
      return recent
        .filter((s) => s.linkedSourceType && s.linkedSourceId && !s.linkedItemTitle)
        .map((s) => ({ type: s.linkedSourceType!, id: s.linkedSourceId! }))
        .filter((item) => {
          const key = `${item.type}:${item.id}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
    },
    [recent],
  )

  // Fetch linked item titles in parallel via generic plugin API
  const itemQueries = useQueries({
    queries: linkedItems.map((item) => ({
      queryKey: ["plugin-item", wsId, item.type, item.id],
      queryFn: () => getPluginItem(item.type, item.id),
    })),
  })

  const itemTitles = itemQueries.map((q) => {
    const data = q.data as Record<string, unknown> | undefined
    return getItemTitle(data as Record<string, unknown>)
  })
  const titleLookup = useMemo(() => {
    const map = new Map<string, string>()
    linkedItems.forEach((item, i) => {
      if (itemTitles[i]) map.set(item.id, itemTitles[i])
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedItems, itemTitles.join("\0")])



  const isRecentRoute = activeTab.startsWith("recent:")
  const activeSessionId = isRecentRoute ? activeTab.slice("recent:".length) : null
  const isSessionsTab = activeTab === "sessions"

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Sessions</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {recent.map((session, i) => {
            const color = getIndicatorColor(session)
            // Prefer summary (set from linkedItemTitle or auto-named).
            // Fall back to fetched title for sessions created before this was consolidated.
            const linkedTitle = session.linkedItemTitle || (session.linkedSourceId ? titleLookup.get(session.linkedSourceId) : undefined)
            const title = linkedTitle || getSessionTitle(session) || session.id
            const isActive = isRecentRoute && session.id === activeSessionId

            const sourceTab: TabId = session.linkedSourceType
              ? `plugin:${session.linkedSourceType}`
              : "sessions"
            const selectedId = session.linkedSourceId ?? undefined

            return (
              <SidebarMenuItem key={session.id}>
                <SidebarMenuButton
                  tooltip={title}
                  onClick={() => {
                    openRecent(session.id, sourceTab, selectedId, i)
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
              isActive={isSessionsTab}

              className={isSessionsTab ? ACTIVE_TAB_CLASSES : "text-muted-foreground"}
              onClick={() => {
                switchTab("sessions")
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
