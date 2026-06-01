import { describe, it, expect } from "vitest"
import { canonicalize, parseStubEntities } from "../entity-extractor.js"

describe("entity-extractor", () => {
  it("Scenario: Stage 2 — seed-entity extraction prefers plugin override, falls back to stub scan — stub scan pulls emails/domains/folders and canonicalises them", () => {
    // The fallback path (no plugin.extractEntities) scans the stub frontmatter
    // and body for emails and folder paths.
    const stub = [
      "---",
      "folder-path: ['Pacifica 2019', 'Wholesale']",
      "---",
      "Contact Caroline at Caroline@Incip.COM about the order.",
    ].join("\n")

    const raw = parseStubEntities(stub)
    // Emails surface a person + its domain.
    expect(raw).toContainEqual({ type: "person", value: "caroline@incip.com" })
    expect(raw).toContainEqual({ type: "domain", value: "incip.com" })
    // Folder-path entries surface folder entities.
    expect(raw.some((e) => e.type === "folder" && e.value === "Pacifica 2019")).toBe(true)

    // Canonicalisation: emails/domains lowercased; folders slugified.
    expect(canonicalize("person", "Caroline@Incip.COM")).toBe("caroline@incip.com")
    expect(canonicalize("domain", "Incip.COM")).toBe("incip.com")
    expect(canonicalize("folder", "Pacifica 2019")).toBe("pacifica-2019")
    expect(canonicalize("company", "The Sourcing Company")).toBe("the-sourcing-company")
  })

  it("returns no entities for a stub with no emails or folders", () => {
    expect(parseStubEntities("just some prose with no contacts")).toEqual([])
  })
})
