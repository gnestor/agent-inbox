import { describe, it, expect } from "vitest"
import { getItemTitle, getItemSubtitle, getItemTimestamp } from "../plugin-utils"
import { formatRelativeDate } from "../formatters"
import type { FieldDef } from "@/types/plugin"

const schema: FieldDef[] = [
  { id: "headline", label: "Headline", type: "text", listRole: "title" },
  { id: "sender", label: "Sender", type: "text", listRole: "subtitle" },
  { id: "when", label: "When", type: "date", listRole: "timestamp" },
]

describe("plugin-utils", () => {
  it("Scenario: `getItemTitle/Subtitle/Timestamp` honor `fieldSchema.listRole` first", () => {
    // schema declares roles -> those fields win over the heuristic key lists
    const item = {
      id: "x",
      headline: "Role Title",
      // a heuristic key that would otherwise be picked if schema were ignored
      title: "Heuristic Title",
      sender: "Alice <alice@example.com>",
      when: "2026-05-01T00:00:00Z",
    }
    expect(getItemTitle(item, schema)).toBe("Role Title")
    // subtitle is passed through formatEmailAddress -> brackets stripped
    expect(getItemSubtitle(item, schema)).toBe("Alice")
    expect(getItemTimestamp(item, schema)).toBe(formatRelativeDate("2026-05-01T00:00:00Z"))
  })

  it("falls back to heuristic key lists only when no listRole is declared", () => {
    const item = { id: "y", subject: "Subj From Heuristic", from: "Bob <bob@x.com>", date: "2026-05-02T00:00:00Z" }
    // no schema -> TITLE_KEYS/SUBTITLE_KEYS/TIMESTAMP_KEYS heuristic
    expect(getItemTitle(item)).toBe("Subj From Heuristic")
    expect(getItemSubtitle(item)).toBe("Bob <bob@x.com>") // no schema -> no formatEmailAddress
    expect(getItemTimestamp(item)).toBe(formatRelativeDate("2026-05-02T00:00:00Z"))
  })

  it("with a schema lacking a subtitle role, does not guess a subtitle", () => {
    const titleOnly: FieldDef[] = [{ id: "headline", label: "Headline", type: "text", listRole: "title" }]
    const item = { id: "z", headline: "T", from: "would-be-subtitle" }
    expect(getItemSubtitle(item, titleOnly)).toBeUndefined()
  })
})
