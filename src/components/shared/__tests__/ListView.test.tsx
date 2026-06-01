// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SidebarProvider } from "@hammies/frontend/components/ui/sidebar"
import { ListView } from "../ListView"
import type { FieldDef } from "@/types/plugin"

// jsdom lacks IntersectionObserver — capture instances so we can fire intersections
let observers: Array<{ cb: IntersectionObserverCallback; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
beforeEach(() => {
  // jsdom lacks matchMedia — PanelHeader's useSidebar/use-mobile needs it
  if (!window.matchMedia) {
    // @ts-expect-error test shim
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })
  }
  observers = []
  // @ts-expect-error test shim
  global.IntersectionObserver = class {
    cb: IntersectionObserverCallback
    observe = vi.fn()
    disconnect = vi.fn()
    unobserve = vi.fn()
    takeRecords = vi.fn()
    rootMargin = ""
    thresholds: number[] = []
    root = null
    constructor(cb: IntersectionObserverCallback, public options?: IntersectionObserverInit) {
      this.cb = cb
      this.rootMargin = options?.rootMargin ?? ""
      observers.push(this)
    }
  }
})

const schema: FieldDef[] = [
  { id: "from", label: "From", type: "text", listRole: "title" },
  { id: "subject", label: "Subject", type: "text", listRole: "subtitle" },
  { id: "date", label: "Date", type: "date", listRole: "timestamp" },
  { id: "isUnread", label: "Unread", type: "boolean", badge: { show: "if-set" } },
  { id: "label", label: "Label", type: "text", badge: { show: "if-set" } },
  {
    id: "status",
    label: "Status",
    type: "select",
    filter: { filterable: true, filterOptions: ["open", "closed"] },
  },
]

const items = [
  { id: "1", from: "Alice", subject: "Hi", date: "2026-05-01T00:00:00Z", isUnread: true, label: "" },
  { id: "2", from: "Bob", subject: "Yo", date: "2026-05-02T00:00:00Z", isUnread: false, label: "work" },
]

const getItemId = (it: Record<string, unknown>) => String(it.id)

describe("ListView compound", () => {
  it("Scenario: Root provides items, schema, selection via context", () => {
    // Using a subcomponent outside the root throws a useful error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<ListView.Body />)).toThrow(/must be used inside <ListView>/)
    spy.mockRestore()
  })

  it("Scenario: `ListView.Header` integrates with `PanelHeader`", () => {
    render(
      <SidebarProvider>
        <ListView items={items} fieldSchema={schema} getItemId={getItemId} onSelect={() => {}}>
          <ListView.Header title="Emails">
            <button>Compose</button>
          </ListView.Header>
        </ListView>
      </SidebarProvider>,
    )
    expect(screen.getByText("Emails")).toBeTruthy()
    expect(screen.getByText("Compose")).toBeTruthy()
  })

  it("Scenario: `ListView.Search` is controlled", () => {
    const onSearch = vi.fn()
    render(
      <ListView items={items} fieldSchema={schema} getItemId={getItemId} onSelect={() => {}}>
        <ListView.Search value="query" onSearch={onSearch} />
      </ListView>,
    )
    const input = screen.getByDisplayValue("query")
    fireEvent.change(input, { target: { value: "new" } })
    // parent owns the value; the component just forwards changes
    expect(onSearch).toHaveBeenCalledWith("new")
  })

  it("Scenario: `ListView.Filters` reads filter fields from the schema", () => {
    const onFilterChange = vi.fn()
    render(
      <ListView items={items} fieldSchema={schema} getItemId={getItemId} onSelect={() => {}}>
        <ListView.Filters activeFilters={{}} onFilterChange={onFilterChange} />
      </ListView>,
    )
    // schema has exactly one filterable field (status) -> a filter trigger renders
    expect(screen.getByTitle("Filters")).toBeTruthy()
  })

  it("Scenario: `ListView.Body` renders rows derived from the schema", () => {
    render(
      <ListView items={items} fieldSchema={schema} getItemId={getItemId} onSelect={() => {}}>
        <ListView.Body />
      </ListView>,
    )
    // title from getTitleField (from), subtitle from getSubtitleField (subject)
    expect(screen.getByText("Alice")).toBeTruthy()
    expect(screen.getByText("Hi")).toBeTruthy()
    expect(screen.getByText("Bob")).toBeTruthy()
  })

  it('Scenario: `badge.show: "if-set"` hides empty values', () => {
    render(
      <ListView items={items} fieldSchema={schema} getItemId={getItemId} onSelect={() => {}}>
        <ListView.Body />
      </ListView>,
    )
    // boolean isUnread true on item 1 -> "Unread" badge present; false on item 2 -> absent
    expect(screen.getAllByText("Unread").length).toBe(1)
    // text label "" (falsy) on item 1 hidden; "work" on item 2 shown
    expect(screen.getByText("work")).toBeTruthy()
  })

  it("Scenario: `hiddenBadgeFields` lets the consumer suppress per-row badges", () => {
    render(
      <ListView items={items} fieldSchema={schema} getItemId={getItemId} onSelect={() => {}}>
        <ListView.Body hiddenBadgeFields={new Set(["isUnread"])} />
      </ListView>,
    )
    // isUnread badge suppressed everywhere
    expect(screen.queryByText("Unread")).toBeNull()
    // other badges still render
    expect(screen.getByText("work")).toBeTruthy()
  })

  it("Scenario: Infinite scroll via `IntersectionObserver`", () => {
    const loadMore = vi.fn()
    render(
      <ListView items={items} fieldSchema={schema} getItemId={getItemId} onSelect={() => {}}>
        <ListView.Body hasMore loadMore={loadMore} />
      </ListView>,
    )
    expect(observers.length).toBe(1)
    expect(observers[0].rootMargin).toBe("200px")
    // simulate the sentinel intersecting -> loadMore fires
    observers[0].cb([{ isIntersecting: true } as IntersectionObserverEntry], observers[0] as unknown as IntersectionObserver)
    expect(loadMore).toHaveBeenCalled()
  })

  it("Scenario: `contentVisibility: auto` is applied per row", () => {
    const { container } = render(
      <ListView items={items} fieldSchema={schema} getItemId={getItemId} onSelect={() => {}}>
        <ListView.Body itemHeight={120} />
      </ListView>,
    )
    // each row wrapper carries the content-visibility hint with the item height
    const wrapper = container.querySelector('[style*="content-visibility"]') as HTMLElement
    expect(wrapper).toBeTruthy()
    expect(wrapper.style.containIntrinsicSize).toContain("120px")
  })

  it("Scenario: Empty / loading / error states", () => {
    // loading -> skeleton
    const { rerender, container } = render(
      <ListView items={[]} fieldSchema={schema} getItemId={getItemId} onSelect={() => {}}>
        <ListView.Body loading />
      </ListView>,
    )
    // skeleton renders animated placeholders (no items, no empty state yet)
    expect(screen.queryByText("No items found")).toBeNull()

    // error -> destructive message
    rerender(
      <ListView items={[]} fieldSchema={schema} getItemId={getItemId} onSelect={() => {}}>
        <ListView.Body error="Boom" />
      </ListView>,
    )
    const err = screen.getByText("Boom")
    expect(err.className).toContain("text-destructive")

    // empty (not loading/erroring) -> EmptyState
    rerender(
      <ListView items={[]} fieldSchema={schema} getItemId={getItemId} onSelect={() => {}}>
        <ListView.Body emptyMessage="Nothing here" />
      </ListView>,
    )
    expect(screen.getByText("Nothing here")).toBeTruthy()
    void container
  })
})
