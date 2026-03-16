// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import {
  getTitleField,
  getSubtitleField,
  getTimestampField,
  getBadgeFields,
  getFilterFields,
  extractFieldValue,
} from "../field-schema"
import type { FieldDef } from "@/types/plugin"

const schema: FieldDef[] = [
  { id: "from", label: "From", type: "text", listRole: "title" },
  { id: "subject", label: "Subject", type: "text", listRole: "subtitle" },
  { id: "date", label: "Date", type: "date", listRole: "timestamp" },
  { id: "status", label: "Status", type: "select",
    badge: { show: "always", variant: "outline" },
    filter: { filterable: true, filterOptions: ["open", "closed"] } },
  { id: "tags", label: "Tags", type: "multiselect",
    badge: { show: "if-set" },
    filter: { filterable: true } },
  { id: "body", label: "Body", type: "html", listRole: "hidden" },
]

describe("field-schema helpers", () => {
  it("getTitleField returns field with listRole title", () => {
    expect(getTitleField(schema)?.id).toBe("from")
  })

  it("getSubtitleField returns field with listRole subtitle", () => {
    expect(getSubtitleField(schema)?.id).toBe("subject")
  })

  it("getTimestampField returns field with listRole timestamp", () => {
    expect(getTimestampField(schema)?.id).toBe("date")
  })

  it("infers roles when listRole is omitted", () => {
    const minimal: FieldDef[] = [
      { id: "name", label: "Name", type: "text" },
      { id: "desc", label: "Description", type: "text" },
      { id: "created", label: "Created", type: "date" },
    ]
    expect(getTitleField(minimal)?.id).toBe("name")
    expect(getSubtitleField(minimal)?.id).toBe("desc")
    expect(getTimestampField(minimal)?.id).toBe("created")
  })

  it("getBadgeFields returns fields with badge config", () => {
    const badges = getBadgeFields(schema)
    expect(badges.map((f) => f.id)).toEqual(["status", "tags"])
  })

  it("getFilterFields returns fields with filter config", () => {
    const filters = getFilterFields(schema)
    expect(filters.map((f) => f.id)).toEqual(["status", "tags"])
  })

  it("extractFieldValue handles dot paths", () => {
    const item = { author: { name: "Alice" }, title: "Hello" }
    expect(extractFieldValue(item, "author.name")).toBe("Alice")
    expect(extractFieldValue(item, "title")).toBe("Hello")
    expect(extractFieldValue(item, "missing")).toBeUndefined()
  })
})
