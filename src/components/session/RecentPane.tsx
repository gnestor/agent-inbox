import { useEffect, useRef } from "react"
import { useLocation } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { useIsMobile } from "@hammies/frontend/hooks"
import { getEmailThread, getTask } from "@/api/client"
import { SessionView } from "./SessionView"
import {
  AnimatedItemSlot,
  DetailContent,
  PANEL_CARD,
} from "@/components/layout/PanelStack"

// Handles /recent/emails/:threadId/session/:sessionId
//         /recent/tasks/:taskId/session/:sessionId
//         /recent/sessions/:sessionId
export function RecentPane() {
  const location = useLocation()
  const isMobile = useIsMobile()
  const { pathname } = location

  const linkedMatch = pathname.match(/^\/recent\/(emails|tasks)\/([^/]+)\/session\/([^/]+)/)
  const standaloneMatch = pathname.match(/^\/recent\/sessions\/([^/]+)/)

  const sessionId = linkedMatch
    ? decodeURIComponent(linkedMatch[3])
    : standaloneMatch
      ? decodeURIComponent(standaloneMatch[1])
      : null

  const linkedType = linkedMatch?.[1] as "emails" | "tasks" | undefined
  const linkedId = linkedMatch ? decodeURIComponent(linkedMatch[2]) : undefined

  // Track direction for item transitions based on sidebar index
  const currentIndex = (location.state as { index?: number } | null)?.index ?? 0
  const prevSessionIdRef = useRef(sessionId)
  const prevIndexRef = useRef(currentIndex)
  const directionRef = useRef(1)
  if (sessionId !== prevSessionIdRef.current) {
    directionRef.current = currentIndex > prevIndexRef.current ? 1 : -1
    prevSessionIdRef.current = sessionId
  }
  prevIndexRef.current = currentIndex
  const direction = directionRef.current

  // Fetch the email subject or task title for the session header
  const { data: emailThread } = useQuery({
    queryKey: ["gmail-thread", linkedId],
    queryFn: () => getEmailThread(linkedId!),
    enabled: linkedType === "emails" && !!linkedId,
  })

  const { data: taskData } = useQuery({
    queryKey: ["task", linkedId],
    queryFn: () => getTask(linkedId!),
    enabled: linkedType === "tasks" && !!linkedId,
  })

  const linkedTitle = emailThread?.subject ?? taskData?.title ?? ""

  // Intercept horizontal wheel events inside panels and redirect to the outer
  // scroll container — same pattern as TabPane (PanelStack lines 509-526).
  // Hooks must be before any early returns.
  const scrollRef = useRef<HTMLDivElement>(null)
  const panelsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (isMobile) return
    const handler = (e: WheelEvent) => {
      if (!scrollRef.current) return
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault()
        scrollRef.current.scrollLeft += e.deltaX
      }
    }
    const el = panelsRef.current
    if (!el) return
    el.addEventListener("wheel", handler, { passive: false })
    return () => el.removeEventListener("wheel", handler)
  }, [isMobile])

  if (!sessionId) {
    return <div className="p-6 text-muted-foreground text-sm">Session not found</div>
  }

  const hasLinkedItem = !!linkedId && !!linkedType

  // Mobile: show session view full-screen (no detail panel, no AnimatedItemSlot)
  if (isMobile) {
    return (
      <div className="h-full shrink-0 overflow-clip p-0 relative">
        <div className="absolute inset-0 bg-card overflow-hidden">
          <SessionView sessionId={sessionId} title={linkedTitle || undefined} />
        </div>
      </div>
    )
  }

  // Desktop: detail + session side-by-side (no list panel)
  // Matches TabPane layout: scrollable flex row outside, AnimatedItemSlot inside
  return (
    <div ref={scrollRef} className="flex flex-row h-full gap-4 shrink-0 overflow-y-hidden overflow-x-auto py-4 pr-4 pl-[var(--sidebar-width)]">
      <div ref={panelsRef} className="shrink-0 overflow-clip h-full p-px [overflow-clip-margin:1rem]">
        <AnimatedItemSlot itemKey={sessionId} direction={direction}>
          <div className="shrink-0 h-full flex flex-row gap-4">
            {hasLinkedItem && linkedId && linkedType && (
              <div className={PANEL_CARD}>
                <DetailContent tab={linkedType} selectedId={linkedId} title={linkedTitle} sessionOpen={true} />
              </div>
            )}
            <div className={PANEL_CARD}>
              <SessionView sessionId={sessionId} title={linkedTitle || undefined} />
            </div>
          </div>
        </AnimatedItemSlot>
      </div>
    </div>
  )
}
