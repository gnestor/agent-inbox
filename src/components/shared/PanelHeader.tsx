import { ChevronLeft } from "lucide-react"

export function PanelHeader({ left, right }: { left: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between px-4 border-b">
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
