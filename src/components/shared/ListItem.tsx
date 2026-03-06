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

export function ListItem({
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
        "w-full text-left px-3 py-2.5 border-b hover:bg-accent/50 transition-colors",
        isSelected && "bg-accent",
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium truncate">{title}</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
              {timestamp}
            </span>
          </div>
          {subtitle && (
            <div className="text-xs text-muted-foreground truncate">
              {subtitle}
            </div>
          )}
          {badges && badges.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {badges.map((badge, i) => (
                <Badge
                  key={i}
                  variant={badge.variant ?? "secondary"}
                  className={cn("text-[10px] px-1.5 py-0", badge.className)}
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
