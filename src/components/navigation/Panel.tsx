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
          // Mobile: full screen, flex column so children can use flex-1 + overflow-y-auto
          ? "shrink-0 h-full w-full bg-card overflow-x-hidden flex flex-col snap-start snap-always"
          // Desktop: fixed width card
          : "shrink-0 h-full flex flex-col overflow-hidden bg-card rounded-lg shadow-sm outline outline-1 -outline-offset-1 outline-border"
      }
      style={isMobile ? undefined : { width }}
    >
      {children}
    </div>
  )
}
