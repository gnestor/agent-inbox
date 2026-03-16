// src/components/navigation/Panel.tsx
import type { PanelType } from "@/types/navigation"
import { DEFAULT_PANEL_WIDTH } from "@/lib/navigation-constants"

interface PanelProps {
  id: string
  variant?: PanelType
  width?: number
  children: React.ReactNode
}

export function Panel({ id, variant, width = DEFAULT_PANEL_WIDTH, children }: PanelProps) {
  return (
    <div
      data-panel-id={id}
      data-panel-variant={variant}
      className="shrink-0 h-full bg-card rounded-lg shadow-sm ring-1 ring-inset ring-border overflow-hidden"
      style={{ width }}
    >
      {children}
    </div>
  )
}
