/**
 * PanelSlot — animates transitions between detail panels using CSS @keyframes.
 *
 * When panelId changes, the old content gets an exit animation and the new
 * content gets an enter animation. Both play simultaneously via CSS keyframes
 * that start immediately on DOM commit (no rAF needed). Cleanup happens via
 * onAnimationEnd (no setTimeout needed).
 *
 * Direction determines animation direction:
 *   direction >= 0 → new panel enters from below, old exits upward
 *   direction <  0 → new panel enters from above, old exits downward
 */
import { useRef, useState } from "react"
import { useIsMobile } from "@hammies/frontend/hooks"
import { useNavigation } from "@/hooks/use-navigation"
import { DEFAULT_PANEL_WIDTH, DURATION, EASE, ITEM_GAP } from "@/lib/navigation-constants"

const EASE_CSS = `cubic-bezier(${EASE.join(",")})`

interface PanelSlotProps {
  panelId: string
  children: React.ReactNode
  /** @deprecated directionRef is no longer needed — reads from NavigationContext */
  directionRef?: React.RefObject<number>
}

interface ExitingPanel {
  id: string
  content: React.ReactNode
  dir: number
}

export function PanelSlot({ panelId, children }: PanelSlotProps) {
  const { getItemDirection } = useNavigation()
  const isMobile = useIsMobile()
  const direction = getItemDirection()

  // Cache children by panelId so exit animation shows old content
  const cacheRef = useRef(new Map<string, React.ReactNode>())
  cacheRef.current.set(panelId, children)

  // Track exiting panel for animation
  const [exiting, setExiting] = useState<ExitingPanel | null>(null)
  const prevIdRef = useRef(panelId)
  const isFirstRef = useRef(true)

  if (panelId !== prevIdRef.current) {
    // panelId changed — start exit animation for old panel
    setExiting({ id: prevIdRef.current, content: cacheRef.current.get(prevIdRef.current)!, dir: direction })
    prevIdRef.current = panelId
    isFirstRef.current = false
  }

  const handleExitEnd = () => {
    setExiting(null)
    // Clean up stale cache entries
    for (const key of cacheRef.current.keys()) {
      if (key !== panelId) cacheRef.current.delete(key)
    }
  }

  const width = isMobile ? "100%" : DEFAULT_PANEL_WIDTH
  const hasAnimation = !isFirstRef.current && exiting

  // Exit animation: slide the old panel out
  const exitAnimation = exiting
    ? `${exiting.dir >= 0 ? "panel-slide-out-up" : "panel-slide-out-down"} ${DURATION}s ${EASE_CSS} forwards`
    : undefined

  // Enter animation: slide the new panel in
  const enterAnimation = hasAnimation
    ? `${direction >= 0 ? "panel-slide-in-up" : "panel-slide-in-down"} ${DURATION}s ${EASE_CSS} forwards`
    : undefined

  return (
    <>
      <style>{panelKeyframes}</style>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          width,
          height: "100%",
          flexShrink: 0,
          ...(isMobile ? { scrollSnapAlign: "start", scrollSnapStop: "always" } : {}),
        }}
      >
        {/* Exiting panel */}
        {exiting && (
          <div
            key={exiting.id}
            style={{ position: "absolute", inset: 0, animation: exitAnimation }}
            onAnimationEnd={handleExitEnd}
          >
            {exiting.content}
          </div>
        )}
        {/* Active panel */}
        <div
          key={panelId}
          style={{
            position: "absolute",
            inset: 0,
            ...(enterAnimation ? { animation: enterAnimation } : {}),
          }}
        >
          {children}
        </div>
      </div>
    </>
  )
}

// CSS @keyframes — injected once via <style> tag
const panelKeyframes = `
@keyframes panel-slide-in-up {
  from { transform: translateY(calc(100% + ${ITEM_GAP}px)); }
  to { transform: translateY(0); }
}
@keyframes panel-slide-out-up {
  from { transform: translateY(0); }
  to { transform: translateY(calc(-100% - ${ITEM_GAP}px)); }
}
@keyframes panel-slide-in-down {
  from { transform: translateY(calc(-100% - ${ITEM_GAP}px)); }
  to { transform: translateY(0); }
}
@keyframes panel-slide-out-down {
  from { transform: translateY(0); }
  to { transform: translateY(calc(100% + ${ITEM_GAP}px)); }
}
`
