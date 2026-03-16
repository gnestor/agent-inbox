import type { FieldDef } from "@/types/plugin"

/** Get the field designated as title (explicit listRole or first text field) */
export function getTitleField(schema: FieldDef[]): FieldDef | undefined {
  return (
    schema.find((f) => f.listRole === "title") ??
    schema.filter((f) => f.listRole !== "hidden").find((f) => f.type === "text")
  )
}

/** Get the field designated as subtitle (explicit listRole or second text field) */
export function getSubtitleField(schema: FieldDef[]): FieldDef | undefined {
  const titleId = getTitleField(schema)?.id
  return (
    schema.find((f) => f.listRole === "subtitle") ??
    schema.filter((f) => f.listRole !== "hidden" && f.type === "text" && f.id !== titleId)[0]
  )
}

/** Get the field designated as timestamp (explicit listRole or first date field) */
export function getTimestampField(schema: FieldDef[]): FieldDef | undefined {
  return (
    schema.find((f) => f.listRole === "timestamp") ??
    schema.filter((f) => f.listRole !== "hidden").find((f) => f.type === "date")
  )
}

/** Get all fields with badge config */
export function getBadgeFields(schema: FieldDef[]): FieldDef[] {
  return schema.filter((f) => f.badge && f.listRole !== "hidden")
}

/** Get all fields with filter config */
export function getFilterFields(schema: FieldDef[]): FieldDef[] {
  return schema.filter((f) => f.filter?.filterable)
}

/** Extract a value from an item using a dot-path (e.g., "author.name") */
export function extractFieldValue(item: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".")
  let current: unknown = item
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}
