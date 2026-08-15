// Generic formatters — re-exported from shared frontend package
export { formatRelativeDate, formatTimeAgo, truncate, formatFileSize, getInitials } from "@hammies/frontend/lib/formatters"

// Domain-specific formatters — inbox only

/** Extract a display title from a generic plugin item (email subject, task title, etc.) */
export function getItemTitle(item: Record<string, unknown> | undefined): string {
  return ((item?.subject ?? item?.title ?? item?.name) as string) || ""
}

export function formatEmailAddress(address: string): string {
  const match = address.match(/^(.+?)\s*<.+>$/)
  return match?.[1] ? match[1].replace(/"/g, "") : address
}

export function sessionStatusLabel(status: string): string {
  switch (status) {
    case "running":
      return "Running"
    case "complete":
      return "Complete"
    case "needs_attention":
      return "Needs Attention"
    case "errored":
      return "Errored"
    case "awaiting_user_input":
      return "Needs Input"
    case "archived":
      return "Archived"
    default:
      return status
  }
}

export function sessionStatusColor(status: string): string {
  switch (status) {
    case "running":
      return "text-chart-3"
    case "complete":
      return "text-chart-1"
    case "needs_attention":
      return "text-chart-2"
    case "errored":
      return "text-destructive"
    // chart-4, not blue-500: Tailwind's fixed palette ignores the theme, and a
    // frozen shade is unreadable in whichever mode it was not picked for.
    case "awaiting_user_input":
      return "text-chart-4"
    default:
      return "text-muted-foreground"
  }
}

export function sessionStatusBadgeClass(status: string): string {
  switch (status) {
    case "running":
      return "bg-chart-3/20 text-chart-3"
    case "complete":
      return "bg-chart-1/20 text-chart-1"
    case "needs_attention":
      return "bg-chart-2/20 text-chart-2"
    case "errored":
      return "bg-destructive/20 text-destructive"
    case "awaiting_user_input":
      return "bg-chart-4/20 text-chart-4"
    case "archived":
      return "bg-foreground/10 text-muted-foreground"
    default:
      return ""
  }
}

