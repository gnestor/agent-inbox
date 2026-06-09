import type { PluginItem, FieldDef } from "@/types/plugin"
import { formatEmailAddress, formatRelativeDate } from "@/lib/formatters"

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

/** Normalize a raw field value (unix seconds, numeric string, or ISO string)
 *  to a date string `formatRelativeDate` can parse; null if not date-like. */
function toDateString(val: unknown): string | null {
  if (typeof val === "number") return new Date(val * 1000).toISOString()
  if (typeof val === "string" && val) {
    const n = Number(val)
    return isNaN(n) ? val : new Date(n * 1000).toISOString()
  }
  return null
}

export function getItemTimestamp(item: PluginItem | Record<string, unknown>, fieldSchema?: FieldDef[]): string {
  // Prefer the schema's timestamp field, else fall back to common keys. All
  // list views render dates via the shared relative format (sessions style).
  const tsField = fieldSchema?.find((f) => f.listRole === "timestamp")
  const keys = tsField ? [tsField.id, ...TIMESTAMP_KEYS] : TIMESTAMP_KEYS
  for (const key of keys) {
    const ds = toDateString(item[key])
    if (ds) return formatRelativeDate(ds)
  }
  return ""
}
