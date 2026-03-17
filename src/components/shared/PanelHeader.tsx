import { useCallback } from "react"
import { ChevronLeft, PanelLeft } from "lucide-react"
import { useSidebar } from "@hammies/frontend/components/ui"
import { useDragTab } from "@/components/navigation/Tab"

export function PanelHeader({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  const dragTab = useDragTab()

  // Pointer handler that disambiguates horizontal (panel scroll) vs vertical (tab switch).
  // Horizontal drags pass through to the scroll container; vertical drags switch tabs.
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!dragTab) return
    // Don't intercept clicks on buttons/links — let them handle their own events
    const target = e.target as HTMLElement
    if (target.closest("button, a, input")) return

    const startX = e.clientX
    const startY = e.clientY
    const deadZone = 10
    let decided = false

    const onMove = (me: PointerEvent) => {
      if (decided) return
      const dx = Math.abs(me.clientX - startX)
      const dy = Math.abs(me.clientY - startY)
      if (dx < deadZone && dy < deadZone) return

      decided = true
      if (dy > dx) {
        // Vertical drag → tab switch
        dragTab.onVerticalDrag(startY, me)
      }
      // Horizontal drag → let scroll container handle
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerup", onUp)
    }
    const onUp = () => {
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerup", onUp)
    }
    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerup", onUp)
  }, [dragTab])

  return (
    <div
      className="flex h-12 shrink-0 items-center justify-between px-4 border-b touch-pan-x"
      onPointerDown={onPointerDown}
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
      className="md:hidden shrink-0 p-1.5 -ml-1.5 rounded-md hover:bg-secondary text-muted-foreground"
      onClick={onClick}
    >
      <ChevronLeft className="h-5 w-5" />
    </button>
  )
}

/** Shown instead of BackButton when the detail panel is the first visible panel
 *  (e.g. sidebar-originated navigation with the list hidden). Opens the sidebar drawer. */
export function SidebarButton() {
  const { setOpenMobile } = useSidebar()
  return (
    <button
      type="button"
      className="md:hidden shrink-0 p-1.5 -ml-1.5 rounded-md hover:bg-secondary text-muted-foreground"
      onClick={() => setOpenMobile(true)}
    >
      <PanelLeft className="h-5 w-5" />
    </button>
  )
}
