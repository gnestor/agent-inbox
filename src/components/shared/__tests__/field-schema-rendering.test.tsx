// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import {
  getTitleField,
  getSubtitleField,
  getTimestampField,
  getBadgeFields,
  getFilterFields,
} from "@/lib/field-schema"
import type { FieldDef } from "@/types/plugin"

// Gmail-like schema
const emailSchema: FieldDef[] = [
  { id: "from", label: "From", type: "text", listRole: "title" },
  { id: "subject", label: "Subject", type: "text", listRole: "subtitle" },
  { id: "date", label: "Date", type: "date", listRole: "timestamp" },
  { id: "isUnread", label: "Unread", type: "boolean", badge: { show: "if-set" } },
  { id: "labels", label: "Labels", type: "multiselect",
    badge: { show: "if-set", variant: "secondary" },
    filter: { filterable: true } },
  { id: "body", label: "Body", type: "html", listRole: "hidden" },
]

// Task-like schema (no explicit listRole — uses inference)
const taskSchema: FieldDef[] = [
  { id: "title", label: "Title", type: "text" },
  { id: "description", label: "Description", type: "text" },
  { id: "dueDate", label: "Due", type: "date" },
  { id: "status", label: "Status", type: "select",
    badge: { show: "always", variant: "outline" },
    filter: { filterable: true, filterOptions: ["todo", "done"] } },
  { id: "priority", label: "Priority", type: "select",
    badge: { show: "if-set" },
    filter: { filterable: true } },
]

describe("email-like schema", () => {
  it("extracts explicit roles", () => {
    expect(getTitleField(emailSchema)?.id).toBe("from")
    expect(getSubtitleField(emailSchema)?.id).toBe("subject")
    expect(getTimestampField(emailSchema)?.id).toBe("date")
  })

  it("hidden fields excluded from badges", () => {
    expect(getBadgeFields(emailSchema).map((f) => f.id)).toEqual(["isUnread", "labels"])
  })

  it("filter fields from schema", () => {
    expect(getFilterFields(emailSchema).map((f) => f.id)).toEqual(["labels"])
  })
})

describe("task-like schema (inferred roles)", () => {
  it("infers title from first text field", () => {
    expect(getTitleField(taskSchema)?.id).toBe("title")
  })

  it("infers subtitle from second text field", () => {
    expect(getSubtitleField(taskSchema)?.id).toBe("description")
  })

  it("infers timestamp from first date field", () => {
    expect(getTimestampField(taskSchema)?.id).toBe("dueDate")
  })

  it("badge fields include status and priority", () => {
    expect(getBadgeFields(taskSchema).map((f) => f.id)).toEqual(["status", "priority"])
  })
})
