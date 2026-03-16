import { ChevronLeft, PanelLeft } from "lucide-react"
import { useSidebar } from "@hammies/frontend/components/ui"
export function PanelHeader({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div
      className="flex h-12 shrink-0 items-center justify-between px-4 border-b"
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

/** Shown instead of BackButton when the detail panel is the first visible panel
 *  (e.g. sidebar-originated navigation with the list hidden). Opens the sidebar drawer. */
export function SidebarButton() {
  const { setOpenMobile } = useSidebar()
  return (
    <button
      type="button"
      className="md:hidden shrink-0 p-1.5 -ml-1.5 rounded-md hover:bg-accent text-muted-foreground"
      onClick={() => setOpenMobile(true)}
    >
      <PanelLeft className="h-5 w-5" />
    </button>
  )
}
