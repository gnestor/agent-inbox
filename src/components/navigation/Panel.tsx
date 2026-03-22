// src/components/navigation/Panel.tsx
import { useIsMobile } from "@hammies/frontend/hooks"
import type { PanelType } from "@/types/navigation"
import { DEFAULT_PANEL_WIDTH } from "@/lib/navigation-constants"

interface PanelProps {
  id: string
  variant?: PanelType
  width?: number
  children: React.ReactNode
}

export function Panel({ id, variant, width = DEFAULT_PANEL_WIDTH, children }: PanelProps) {
  const isMobile = useIsMobile()

  return (
    <div
      data-panel-id={id}
      data-panel-variant={variant}
      className={
        isMobile
          // Mobile: full screen, no card styling, snap alignment
          ? "shrink-0 h-full w-full bg-card overflow-hidden"
          // Desktop: fixed width card
          : "shrink-0 h-full bg-card rounded-lg shadow-sm outline outline-1 -outline-offset-1 outline-border"
      }
      style={isMobile ? { scrollSnapAlign: "start", scrollSnapStop: "always" } : { width }}
    >
      {children}
    </div>
  )
}
