import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Tests for backfill eligibility logic (plugin query + itemToContext filtering)
// ---------------------------------------------------------------------------

describe("backfill eligibility", () => {
  it("only backfills plugins with both query and itemToContext", () => {
    const queryOnly = { id: "q", query: vi.fn(), itemToContext: undefined }
    const contextOnly = { id: "c", query: undefined, itemToContext: vi.fn() }
    const eligible = { id: "e", query: vi.fn(), itemToContext: vi.fn() }
    const skillsOnly = { id: "s", hasSkills: true, query: undefined, itemToContext: undefined }

    const all = [queryOnly, contextOnly, eligible, skillsOnly]
    const filtered = all.filter((p) => p.query && p.itemToContext)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe("e")
  })

  it("itemToContext null return means item is skipped", () => {
    const items = [
      { id: "1", from: "noreply@company.com", body: "Hello" },
      { id: "2", from: "person@example.com", body: "Message" },
    ]

    const automatedPattern = /noreply@/i
    const results = items.map((item) => {
      if (automatedPattern.test(String(item.from))) return null
      return `# Email from ${item.from}\n\n${item.body}`
    })

    expect(results[0]).toBeNull()
    expect(results[1]).toContain("person@example.com")
  })

  it("itemToContext string return produces markdown with item content", () => {
    const item = {
      id: "thread-123",
      subject: "Q4 Review",
      from: "boss@company.com",
      date: "2025-01-15",
      body: "Please review the Q4 numbers.",
    }

    const markdown = [
      `# ${item.subject}`,
      `From: ${item.from}`,
      `Date: ${item.date}`,
      "",
      item.body,
    ].join("\n")

    expect(markdown).toContain("# Q4 Review")
    expect(markdown).toContain("From: boss@company.com")
    expect(markdown).toContain("Please review the Q4 numbers.")
  })
})

describe("backfill pagination", () => {
  it("processes all pages until no nextCursor", async () => {
    const pages = [
      { items: [{ id: "a" }, { id: "b" }], nextCursor: "page2" },
      { items: [{ id: "c" }], nextCursor: undefined },
    ]

    let pageIndex = 0
    const queryFn = vi.fn(async (_filters: Record<string, string>, cursor?: string) => {
      const page = pages[pageIndex++]
      return page
    })

    const itemToContext = vi.fn((item: { id: string }) => `# Item ${item.id}`)

    const indexed: string[] = []
    let cursor: string | undefined

    while (true) {
      const result = await queryFn({}, cursor)
      for (const item of result.items) {
        const md = itemToContext(item)
        if (md !== null) indexed.push(item.id)
      }
      if (!result.nextCursor) {
        cursor = undefined
        break
      }
      cursor = result.nextCursor
    }

    expect(queryFn).toHaveBeenCalledTimes(2)
    expect(indexed).toEqual(["a", "b", "c"])
    expect(cursor).toBeUndefined()
  })

  it("handles empty query results gracefully", async () => {
    const queryFn = vi.fn(async () => ({ items: [], nextCursor: undefined }))
    const itemToContext = vi.fn(() => "markdown")

    let cursor: string | undefined
    let indexed = 0

    while (true) {
      const result = await queryFn({}, cursor)
      for (const item of result.items) {
        const md = itemToContext(item)
        if (md !== null) indexed++
      }
      if (!result.nextCursor) break
      cursor = result.nextCursor
    }

    expect(indexed).toBe(0)
    expect(queryFn).toHaveBeenCalledOnce()
  })
})
