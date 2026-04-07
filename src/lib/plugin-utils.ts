import type { PluginItem, FieldDef } from "@/types/plugin"
import { formatEmailAddress } from "@/lib/formatters"

const TITLE_KEYS = ["title", "name", "channelName", "subject", "text", "summary"]
const SUBTITLE_KEYS = ["subtitle", "description", "latestText", "preview", "from"]
const TIMESTAMP_KEYS = ["latestTs", "updatedAt", "createdAt", "timestamp", "date", "ts"]

export function getItemTitle(item: PluginItem | Record<string, unknown>, fieldSchema?: FieldDef[]): string {
  // Use fieldSchema listRole if available
  if (fieldSchema) {
    const titleField = fieldSchema.find((f) => f.listRole === "title")
    if (titleField) {
      const val = item[titleField.id]
      if (typeof val === "string" && val) return val
    }
  }
  for (const key of TITLE_KEYS) {
    if (typeof item[key] === "string" && item[key]) return item[key] as string
  }
  return String(item.id ?? "")
}

export function getItemSubtitle(item: PluginItem | Record<string, unknown>, fieldSchema?: FieldDef[]): string | undefined {
  if (fieldSchema) {
    const subtitleField = fieldSchema.find((f) => f.listRole === "subtitle")
    if (subtitleField) {
      const val = item[subtitleField.id]
      if (typeof val === "string" && val) return formatEmailAddress(val)
    }
    // If fieldSchema exists but has no subtitle role, don't guess
    return undefined
  }
  // Fallback for plugins without fieldSchema
  for (const key of SUBTITLE_KEYS) {
    if (typeof item[key] === "string" && item[key]) return item[key] as string
  }
  return undefined
}

export function getItemTimestamp(item: PluginItem | Record<string, unknown>, fieldSchema?: FieldDef[]): string {
  if (fieldSchema) {
    const tsField = fieldSchema.find((f) => f.listRole === "timestamp")
    if (tsField) {
      const val = item[tsField.id]
      if (val) {
        if (typeof val === "number") return new Date(val * 1000).toLocaleDateString()
        if (typeof val === "string") {
          const n = Number(val)
          if (!isNaN(n)) return new Date(n * 1000).toLocaleDateString()
          return new Date(val).toLocaleDateString()
        }
      }
    }
  }
  for (const key of TIMESTAMP_KEYS) {
    const val = item[key]
    if (!val) continue
    if (typeof val === "number") return new Date(val * 1000).toLocaleDateString()
    if (typeof val === "string") {
      const n = Number(val)
      if (!isNaN(n)) return new Date(n * 1000).toLocaleDateString()
      return new Date(val).toLocaleDateString()
    }
  }
  return ""
}
