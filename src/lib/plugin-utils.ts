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
      const n = parseFloat(val)
      if (!isNaN(n) && val.includes(".")) return new Date(n * 1000).toLocaleDateString()
      return new Date(val).toLocaleDateString()
    }
  }
  return ""
}
