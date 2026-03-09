import { useCallback } from "react"
import { ChevronLeft } from "lucide-react"
import { useIsMobile } from "@hammies/frontend/hooks"
import { cn } from "@hammies/frontend/lib/utils"
import { useHeaderNav } from "@/hooks/use-header-nav"

const AXIS_THRESHOLD = 8
const SWIPE_THRESHOLD = 60

export function PanelHeader({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  const isMobile = useIsMobile()
  const { onTabSwipe, startOverlayDrag, startTabDrag } = useHeaderNav()
  const hasDragNav = isMobile && !!(onTabSwipe || startOverlayDrag || startTabDrag)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!hasDragNav) return

      const startX = e.clientX
      const startY = e.clientY
      const nativeEvent = e.nativeEvent

      const onMove = (ev: PointerEvent) => {
        const dx = Math.abs(ev.clientX - startX)
        const dy = Math.abs(ev.clientY - startY)

        if (dx < AXIS_THRESHOLD && dy < AXIS_THRESHOLD) return

        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)

        if (startOverlayDrag) {
          // Overlay panel present — hand off both axes to Framer Motion
          startOverlayDrag(nativeEvent)
        } else if (dy > dx && startTabDrag) {
          // No overlay — hand off vertical gesture to tab pane drag
          startTabDrag(nativeEvent)
        } else if (dy > dx && onTabSwipe) {
          // Fallback: manual discrete tab swipe
          const onTabUp = (upEv: PointerEvent) => {
            window.removeEventListener("pointerup", onTabUp)
            const totalDy = upEv.clientY - startY
            if (Math.abs(totalDy) > SWIPE_THRESHOLD) onTabSwipe(totalDy < 0 ? 1 : -1)
          }
          window.addEventListener("pointerup", onTabUp)
        }
      }

      const onUp = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [hasDragNav, onTabSwipe, startOverlayDrag, startTabDrag],
  )

  return (
    <div
      className={cn(
        "flex h-12 shrink-0 items-center justify-between px-4 border-b",
        hasDragNav && "touch-none select-none",
      )}
      onPointerDown={hasDragNav ? handlePointerDown : undefined}
    >
      <div className="flex items-center gap-2 min-w-0">{left}</div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  )
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="md:hidden shrink-0 p-1.5 -ml-1.5 rounded-md hover:bg-accent text-muted-foreground"
      onClick={onClick}
    >
      <ChevronLeft className="h-5 w-5" />
    </button>
  )
}
