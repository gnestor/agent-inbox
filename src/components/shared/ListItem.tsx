import { memo } from "react"
import { cn } from "@hammies/frontend/lib/utils"
import { Badge } from "@hammies/frontend/components/ui"

export interface ListItemBadge {
  label: string
  variant?: "default" | "secondary" | "destructive" | "outline"
  className?: string
}

interface ListItemProps {
  title: string
  subtitle?: string
  timestamp: string
  badges?: ListItemBadge[]
  icon?: React.ReactNode
  isSelected?: boolean
  onClick: () => void
}

function badgesEqual(a?: ListItemBadge[], b?: ListItemBadge[]): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].label !== b[i].label ||
      a[i].variant !== b[i].variant ||
      a[i].className !== b[i].className
    )
      return false
  }
  return true
}

function ListItemInner({
  title,
  subtitle,
  timestamp,
  badges,
  icon,
  isSelected,
  onClick,
}: ListItemProps) {
  return (
    <button
      className={cn(
        "w-full h-full text-left px-[15px] py-3 mx-px border-b transition-colors overflow-hidden",
        isSelected ? "bg-primary text-primary-foreground" : "hover:bg-secondary",
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium truncate">{title}</span>
            <span className={cn("text-xs whitespace-nowrap shrink-0", isSelected ? "text-primary-foreground/70" : "text-muted-foreground")}>
              {timestamp}
            </span>
          </div>
          {subtitle && <div className={cn("text-xs truncate", isSelected ? "text-primary-foreground/70" : "text-muted-foreground")}>{subtitle}</div>}
          {badges && badges.length > 0 && (
            <div className="flex items-center gap-1 overflow-hidden">
              {badges.map((badge, i) => (
                <Badge
                  key={i}
                  variant={badge.variant ?? "secondary"}
                  className={cn(
                    "text-[10px] px-1.5 py-0 border-0",
                    isSelected && "!bg-primary-foreground/20 !text-primary-foreground",
                    badge.className,
                  )}
                >
                  {badge.label}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

// onClick skipped: inline closures navigate to the same route as long as item identity
// (title/isSelected) hasn't changed. icon skipped: currently unused by all callers.
export const ListItem = memo(
  ListItemInner,
  (prev, next) =>
    prev.title === next.title &&
    prev.subtitle === next.subtitle &&
    prev.timestamp === next.timestamp &&
    prev.isSelected === next.isSelected &&
    badgesEqual(prev.badges, next.badges),
)
