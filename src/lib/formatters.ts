import { formatDistanceToNow, format, isToday, isYesterday, isThisYear } from "date-fns"

export function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (isToday(date)) return format(date, "h:mm a")
  if (isYesterday(date)) return "Yesterday"
  if (isThisYear(date)) return format(date, "MMM d")
  return format(date, "MMM d, yyyy")
}

export function formatTimeAgo(dateStr: string): string {
  return formatDistanceToNow(new Date(dateStr), { addSuffix: true })
}

export function formatEmailAddress(address: string): string {
  const match = address.match(/^(.+?)\s*<.+>$/)
  return match ? match[1].replace(/"/g, "") : address
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 1) + "\u2026"
}

export function sessionStatusLabel(status: string): string {
  switch (status) {
    case "running": return "Running"
    case "complete": return "Complete"
    case "needs_attention": return "Needs Attention"
    case "errored": return "Error"
    default: return status
  }
}

export function sessionStatusColor(status: string): string {
  switch (status) {
    case "running": return "text-chart-3"
    case "complete": return "text-chart-1"
    case "needs_attention": return "text-chart-2"
    case "errored": return "text-destructive"
    default: return "text-muted-foreground"
  }
}
