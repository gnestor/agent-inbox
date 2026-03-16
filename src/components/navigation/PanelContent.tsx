// src/components/navigation/PanelContent.tsx
import type { PanelState } from "@/types/navigation"

interface PanelContentProps {
  panel: PanelState
}

/**
 * Maps PanelState to the corresponding React component.
 * This is a placeholder — each panel type will be wired up
 * during the tab migration phase (Plan C).
 */
export function PanelContent({ panel }: PanelContentProps) {
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
      <div className="text-center">
        <p className="font-medium">{panel.type}</p>
        <p className="text-xs mt-1">{panel.id}</p>
        <pre className="text-xs mt-2 max-w-[300px] overflow-hidden">
          {JSON.stringify(panel.props, null, 2)}
        </pre>
      </div>
    </div>
  )
}
