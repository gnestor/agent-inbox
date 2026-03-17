/**
 * PanelSlot — animates transitions between detail panels for different items.
 *
 * Uses SlotStack in keepPrevious mode: only the active panel and the
 * previous panel (during transition) are mounted. The previous panel
 * is unmounted after the transition completes to avoid memory bloat.
 */
import { useContext } from "react"
import { useIsMobile } from "@hammies/frontend/hooks"
import { SlotStack } from "./SlotStack"
import { NavigationContext } from "./NavigationProvider"
import { DEFAULT_PANEL_WIDTH } from "@/lib/navigation-constants"

interface PanelSlotProps {
  panelId: string
  children: React.ReactNode
  /** @deprecated directionRef is no longer needed — reads from NavigationContext */
  directionRef?: React.RefObject<number>
}

export function PanelSlot({ panelId, children }: PanelSlotProps) {
  const ctx = useContext(NavigationContext)
  const isMobile = useIsMobile()
  const direction = ctx?.itemDirectionRef.current ?? 1

  if (isMobile) {
    // On mobile, MobileTab uses horizontal scroll-snap.
    // PanelSlot needs: fullscreen width, shrink-0 (via SlotStack), and snap alignment.
    return (
      <SlotStack
        activeKey={panelId}
        renderItem={() => children}
        mode="keepPrevious"
        direction={direction}
        className="w-full h-full"
        style={{ scrollSnapAlign: "start", scrollSnapStop: "always" }}
      />
    )
  }

  return (
    <SlotStack
      activeKey={panelId}
      renderItem={() => children}
      mode="keepPrevious"
      direction={direction}
      width={DEFAULT_PANEL_WIDTH}
    />
  )
}
