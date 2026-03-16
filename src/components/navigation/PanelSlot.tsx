/**
 * PanelSlot — animates transitions between detail panels for different items.
 *
 * Uses SlotStack in keepPrevious mode: only the active panel and the
 * previous panel (during transition) are mounted. The previous panel
 * is unmounted after the transition completes to avoid memory bloat.
 */
import { useContext } from "react"
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
  const direction = ctx?.itemDirectionRef.current ?? 1

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
