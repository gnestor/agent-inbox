import type { PluginItem } from "@/types/plugin"

const TITLE_KEYS = ["title", "name", "channelName", "subject", "text", "summary"]
const SUBTITLE_KEYS = ["subtitle", "description", "latestText", "preview"]
const TIMESTAMP_KEYS = ["latestTs", "updatedAt", "createdAt", "timestamp", "date", "ts"]

export function getItemTitle(item: PluginItem | Record<string, unknown>): string {
  for (const key of TITLE_KEYS) {
    if (typeof item[key] === "string" && item[key]) return item[key] as string
  }
  return String(item.id ?? "")
}

export function getItemSubtitle(item: PluginItem | Record<string, unknown>): string | undefined {
  for (const key of SUBTITLE_KEYS) {
    if (typeof item[key] === "string" && item[key]) return item[key] as string
  }
  return undefined
}

export function getItemTimestamp(item: PluginItem | Record<string, unknown>): string {
  for (const key of TIMESTAMP_KEYS) {
    const val = item[key]
    if (!val) continue
    if (typeof val === "number") return new Date(val * 1000).toLocaleDateString()
    if (typeof val === "string") {
      // ISO date strings contain hyphens/letters — parse directly, don't treat as epoch
      if (/[a-zA-Z-]/.test(val)) return new Date(val).toLocaleDateString()
      // Numeric strings with dots (e.g. Slack "1711641600.123") are epoch seconds
      const n = parseFloat(val)
      if (!isNaN(n)) return new Date(n * 1000).toLocaleDateString()
      return new Date(val).toLocaleDateString()
    }
  }
  return ""
}
