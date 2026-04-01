// Generic formatters — re-exported from shared frontend package
export { formatRelativeDate, formatTimeAgo, truncate, formatFileSize, getInitials } from "@hammies/frontend/lib/formatters"

// Domain-specific formatters — inbox only

/** Extract a display title from a generic plugin item (email subject, task title, etc.) */
export function getItemTitle(item: Record<string, unknown> | undefined): string {
  return ((item?.subject ?? item?.title ?? item?.name) as string) || ""
}

export function formatEmailAddress(address: string): string {
  const match = address.match(/^(.+?)\s*<.+>$/)
  return match ? match[1].replace(/"/g, "") : address
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
    case "awaiting_user_input":
      return "text-blue-500"
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
      return "bg-blue-500/20 text-blue-500"
    case "archived":
      return "bg-foreground/10 text-muted-foreground"
    default:
      return ""
  }
}

