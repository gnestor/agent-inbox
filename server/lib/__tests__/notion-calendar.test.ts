import { vi, describe, it, expect, beforeEach } from "vitest"

// Mock credentials and DB before importing notion
const mockGetDb = vi.fn()
vi.mock("../credentials.js", () => ({
  getNotionToken: () => "test-token",
}))
vi.mock("../../db/schema.js", () => ({
  getDb: () => mockGetDb(),
}))

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Import after mocks are set up
const { queryCalendarItems, getCalendarItemDetail } = await import("../notion.js")

function makePage(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-1",
    created_time: "2024-01-15T10:00:00.000Z",
    last_edited_time: "2024-01-16T12:00:00.000Z",
    url: "https://notion.so/page-1",
    properties: {
      Name: { title: [{ plain_text: "Team sync" }] },
      Status: { status: { name: "In Progress" } },
      Tags: { multi_select: [{ name: "meeting" }, { name: "weekly" }] },
      Assignee: { people: [{ name: "Alice", person: { email: "alice@example.com" } }] },
      Date: { date: { start: "2024-01-20" } },
    },
    ...overrides,
  }
}

function okJson(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
  })
}

describe("queryCalendarItems", () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it("queries the calendar database with no filters", async () => {
    mockFetch.mockReturnValueOnce(
      okJson({ results: [makePage()], has_more: false, next_cursor: null }),
    )

    const result = await queryCalendarItems()

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain("66dfb652-32f1-4b24-b7df-0d4b52528f42")
    const body = JSON.parse(opts.body)
    expect(body.sorts).toEqual([{ property: "Date", direction: "ascending" }])
    expect(body.filter).toBeUndefined()

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      id: "page-1",
      title: "Team sync",
      status: "In Progress",
      tags: ["meeting", "weekly"],
      assignee: "Alice",
      date: "2024-01-20",
    })
    expect(result.nextCursor).toBeNull()
  })

  it("applies status filter", async () => {
    mockFetch.mockReturnValueOnce(
      okJson({ results: [], has_more: false }),
    )

    await queryCalendarItems({ status: "Done" })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.filter).toEqual({ property: "Status", status: { equals: "Done" } })
  })

  it("applies multi-value status filter as OR", async () => {
    mockFetch.mockReturnValueOnce(okJson({ results: [], has_more: false }))

    await queryCalendarItems({ status: "Done,In Progress" })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.filter).toEqual({
      or: [
        { property: "Status", status: { equals: "Done" } },
        { property: "Status", status: { equals: "In Progress" } },
      ],
    })
  })

  it("applies tags filter (each tag as AND condition)", async () => {
    mockFetch.mockReturnValueOnce(okJson({ results: [], has_more: false }))

    await queryCalendarItems({ tags: "meeting,weekly" })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.filter).toEqual({
      and: [
        { property: "Tags", multi_select: { contains: "meeting" } },
        { property: "Tags", multi_select: { contains: "weekly" } },
      ],
    })
  })

  it("applies assignee filter", async () => {
    mockFetch.mockReturnValueOnce(okJson({ results: [], has_more: false }))

    await queryCalendarItems({ assignee: "Alice" })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.filter).toEqual({ property: "Assignee", people: { contains: "Alice" } })
  })

  it("passes cursor for pagination", async () => {
    mockFetch.mockReturnValueOnce(
      okJson({ results: [], has_more: true, next_cursor: "cursor-2" }),
    )

    const result = await queryCalendarItems({ cursor: "cursor-1" })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.start_cursor).toBe("cursor-1")
    expect(result.nextCursor).toBe("cursor-2")
  })

  it("returns empty date string when Date property is absent", async () => {
    const page = makePage({ properties: { ...makePage().properties, Date: { date: null } } })
    mockFetch.mockReturnValueOnce(okJson({ results: [page], has_more: false }))

    const result = await queryCalendarItems()
    expect(result.items[0].date).toBe("")
  })
})

describe("getCalendarItemDetail", () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it("fetches page and blocks then returns merged detail", async () => {
    const page = makePage()
    const blocks = [
      { id: "b1", type: "paragraph", has_children: false, paragraph: { rich_text: [{ plain_text: "Hello" }] } },
    ]

    // Page fetch
    mockFetch.mockReturnValueOnce(okJson(page))
    // Blocks fetch
    mockFetch.mockReturnValueOnce(okJson({ results: blocks, has_more: false }))

    const detail = await getCalendarItemDetail("page-1")

    expect(detail.id).toBe("page-1")
    expect(detail.title).toBe("Team sync")
    expect(detail.date).toBe("2024-01-20")
    expect(detail.body).toBe("Hello")
    expect(detail.children).toHaveLength(1)
    expect(detail.properties).toBeDefined()
  })
})
