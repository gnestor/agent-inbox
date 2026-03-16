# Phase 2.5B: ListView + DetailView — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build schema-driven `ListView` and `DetailView` components that replace the duplicated list/detail boilerplate across EmailList, TaskList, CalendarList, SessionList, EmailThread, TaskDetail, CalendarDetail.

**Architecture:** `ListView<T>` accepts a `FieldDef[]` schema and derives title, subtitle, timestamp, badges, and filters automatically. `DetailView` wraps content with a standard header/loading/error shell. Both are pure rendering components — no data fetching, no navigation logic. A `FilterPopover` component is extracted from the duplicated filter UI.

**Tech Stack:** React 19, TypeScript, TanStack Virtual (via useVirtualizerSafe), shadcn/ui components

**Depends on:** Plan A (navigation types, specifically `FieldDef.listRole` addition to `src/types/plugin.ts`)

**Spec:** `packages/inbox/.plans/phase-2.5-navigation-redesign-spec.md`

---

## File Structure

```
src/
├── types/
│   └── plugin.ts                    — MODIFY: add listRole to FieldDef
├── components/
│   └── shared/
│       ├── ListView.tsx             — CREATE: schema-driven virtualized list
│       ├── DetailView.tsx           — CREATE: schema-driven detail wrapper
│       ├── FilterPopover.tsx        — CREATE: schema-driven filter UI
│       └── __tests__/
│           ├── ListView.test.tsx    — CREATE: rendering + schema tests
│           └── DetailView.test.tsx  — CREATE: three rendering modes
├── lib/
│   └── field-schema.ts             — CREATE: helpers to extract title/badges/filters from FieldDef[]
```

---

## Chunk 1: FieldDef Extension + Schema Helpers

### Task 1: Add listRole to FieldDef

**Files:**
- Modify: `src/types/plugin.ts`

- [ ] **Step 1: Add listRole field**

Add `listRole` to the `FieldDef` interface (after the `detailWidget` field, ~line 88):

```typescript
  /**
   * Role in the list view. If omitted, inferred from type:
   * first text → title, second text → subtitle, first date → timestamp.
   * Use "hidden" to exclude from list rendering.
   */
  listRole?: "title" | "subtitle" | "timestamp" | "hidden"
```

- [ ] **Step 2: Commit**

```bash
git add src/types/plugin.ts
git commit -m "feat: add listRole to FieldDef for schema-driven list rendering"
```

### Task 2: Field schema helper functions

**Files:**
- Create: `src/lib/field-schema.ts`
- Create: `src/lib/__tests__/field-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/__tests__/field-schema.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inbox && npx vitest run src/lib/__tests__/field-schema.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// src/lib/field-schema.ts
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
```

- [ ] **Step 4: Run tests**

Run: `cd packages/inbox && npx vitest run src/lib/__tests__/field-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/field-schema.ts src/lib/__tests__/field-schema.test.ts
git commit -m "feat: add field-schema helpers (extract title/badges/filters from FieldDef)"
```

---

## Chunk 2: FilterPopover + ListView

### Task 3: FilterPopover component

**Files:**
- Create: `src/components/shared/FilterPopover.tsx`

- [ ] **Step 1: Create FilterPopover**

Extracted from the duplicated filter UI in EmailList/TaskList/CalendarList/SessionList:

```tsx
// src/components/shared/FilterPopover.tsx
import { Popover, PopoverTrigger, PopoverContent } from "@hammies/frontend/components/ui"
import { SlidersHorizontal } from "lucide-react"
import { FilterCombobox } from "./FilterCombobox"
import type { FieldDef } from "@/types/plugin"
import { getFilterFields } from "@/lib/field-schema"

interface FilterPopoverProps {
  fieldSchema: FieldDef[]
  activeFilters: Record<string, string>
  onFilterChange: (key: string, value: string) => void
}

export function FilterPopover({ fieldSchema, activeFilters, onFilterChange }: FilterPopoverProps) {
  const filterFields = getFilterFields(fieldSchema)
  if (filterFields.length === 0) return null

  const hasActiveFilters = Object.values(activeFilters).some((v) => v.length > 0)

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={`shrink-0 p-1.5 rounded-md hover:bg-accent ${hasActiveFilters ? "text-sidebar-primary" : "text-muted-foreground"}`}
            title="Filters"
          />
        }
      >
        <SlidersHorizontal className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 space-y-1.5">
        {filterFields.map((field) => {
          const options = Array.isArray(field.filter?.filterOptions)
            ? field.filter.filterOptions.map((o) => (typeof o === "string" ? { value: o, label: o } : o))
            : []

          return (
            <FilterCombobox
              key={field.id}
              value={(activeFilters[field.id] || "").split(",").filter(Boolean)}
              onValueChange={(vals) => onFilterChange(field.id, vals.join(","))}
              items={options}
              placeholder={`${field.label}...`}
            />
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/shared/FilterPopover.tsx
git commit -m "feat: add schema-driven FilterPopover component"
```

### Task 4: ListView component

**Files:**
- Create: `src/components/shared/ListView.tsx`

- [ ] **Step 1: Create ListView**

```tsx
// src/components/shared/ListView.tsx
import { useRef, useMemo, useState, useDeferredValue } from "react"
import { useVirtualizerSafe } from "@/hooks/use-virtualizer-safe"
import { ListItem, type ListItemBadge } from "./ListItem"
import { PanelHeader, SidebarButton } from "./PanelHeader"
import { SearchInput } from "./SearchInput"
import { FilterPopover } from "./FilterPopover"
import { ListSkeleton } from "./ListSkeleton"
import { EmptyState } from "./EmptyState"
import { Bot } from "lucide-react"
import type { FieldDef } from "@/types/plugin"
import {
  getTitleField,
  getSubtitleField,
  getTimestampField,
  getBadgeFields,
  extractFieldValue,
} from "@/lib/field-schema"
import { formatRelativeDate, truncate } from "@/lib/formatters"

interface ListViewProps<T extends Record<string, unknown>> {
  title: string
  icon?: React.ReactNode
  items: T[]
  loading?: boolean
  error?: string | null
  fieldSchema: FieldDef[]
  getItemId: (item: T) => string
  selectedId?: string
  onSelect: (id: string, index: number) => void
  itemHeight?: number
  searchPlaceholder?: string
  onSearch?: (query: string) => void
  localSearch?: (item: T, query: string) => boolean
  hasMore?: boolean
  loadMore?: () => void
  headerRight?: React.ReactNode
  activeFilters?: Record<string, string>
  onFilterChange?: (key: string, value: string) => void
}

export function ListView<T extends Record<string, unknown>>({
  title,
  icon,
  items,
  loading,
  error,
  fieldSchema,
  getItemId,
  selectedId,
  onSelect,
  itemHeight = 76,
  searchPlaceholder,
  onSearch,
  localSearch,
  hasMore,
  loadMore,
  headerRight,
  activeFilters = {},
  onFilterChange,
}: ListViewProps<T>) {
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)

  // Schema-derived field extractors
  const titleField = useMemo(() => getTitleField(fieldSchema), [fieldSchema])
  const subtitleField = useMemo(() => getSubtitleField(fieldSchema), [fieldSchema])
  const timestampField = useMemo(() => getTimestampField(fieldSchema), [fieldSchema])
  const badgeFields = useMemo(() => getBadgeFields(fieldSchema), [fieldSchema])

  // Handle search
  function handleSearch(value: string) {
    setSearch(value)
    onSearch?.(value)
  }

  // Client-side filtering
  const filteredItems = useMemo(() => {
    if (!localSearch || !deferredSearch) return items
    return items.filter((item) => localSearch(item, deferredSearch))
  }, [items, deferredSearch, localSearch])

  // Virtualizer
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizerSafe({
    count: filteredItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => itemHeight,
    getItemKey: (index) => getItemId(filteredItems[index]) ?? index,
    overscan: 5,
  })

  // Build badges for an item from schema
  function buildBadges(item: T): ListItemBadge[] {
    const badges: ListItemBadge[] = []
    for (const field of badgeFields) {
      const value = extractFieldValue(item, field.id)
      if (field.badge?.show === "if-set" && !value) continue
      if (value === undefined || value === null) continue

      const values = Array.isArray(value) ? value : [value]
      for (const v of values) {
        const label = String(v)
        const className = field.badge?.colorFn?.(label)
        badges.push({
          label,
          variant: field.badge?.variant ?? "secondary",
          className,
        })
      }
    }
    return badges
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        left={
          <>
            <SidebarButton />
            <h2 className="font-semibold text-sm">{title}</h2>
          </>
        }
        right={
          <>
            {onFilterChange && (
              <FilterPopover
                fieldSchema={fieldSchema}
                activeFilters={activeFilters}
                onFilterChange={onFilterChange}
              />
            )}
            {headerRight}
          </>
        }
      />
      <SearchInput
        value={search}
        onChange={handleSearch}
        placeholder={searchPlaceholder ?? `Search ${title.toLowerCase()}...`}
      />
      <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
        {loading && <ListSkeleton itemHeight={itemHeight} />}
        {error && <div className="p-3 text-sm text-destructive">{error}</div>}
        {!loading && filteredItems.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = filteredItems[virtualRow.index]
              const id = getItemId(item)

              const itemTitle = titleField
                ? String(extractFieldValue(item, titleField.id) ?? "")
                : truncate(String(item.id ?? ""), 60)
              const subtitle = subtitleField
                ? String(extractFieldValue(item, subtitleField.id) ?? "")
                : undefined
              const timestamp = timestampField
                ? formatRelativeDate(String(extractFieldValue(item, timestampField.id) ?? ""))
                : ""

              return (
                <div
                  key={id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${itemHeight}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ListItem
                    title={itemTitle}
                    subtitle={subtitle}
                    timestamp={timestamp}
                    badges={buildBadges(item)}
                    isSelected={selectedId === id}
                    onClick={() => onSelect(id, virtualRow.index)}
                  />
                </div>
              )
            })}
          </div>
        )}
        {!loading && filteredItems.length === 0 && !error && (
          <EmptyState icon={Bot} message={`No ${title.toLowerCase()} found`} />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/shared/ListView.tsx
git commit -m "feat: add schema-driven ListView component"
```

---

## Chunk 3: DetailView

### Task 5: DetailView component

**Files:**
- Create: `src/components/shared/DetailView.tsx`

- [ ] **Step 1: Create DetailView**

```tsx
// src/components/shared/DetailView.tsx
import { PanelHeader, BackButton, SidebarButton } from "./PanelHeader"
import { PanelSkeleton } from "./PanelSkeleton"

interface DetailViewProps {
  title?: string
  loading?: boolean
  error?: string | null
  headerRight?: React.ReactNode
  onBack?: () => void
  isFromSidebar?: boolean
  children?: React.ReactNode
}

export function DetailView({
  title,
  loading,
  error,
  headerRight,
  onBack,
  isFromSidebar,
  children,
}: DetailViewProps) {
  const header = (
    <PanelHeader
      left={
        <>
          {isFromSidebar ? (
            <SidebarButton />
          ) : onBack ? (
            <BackButton onClick={onBack} />
          ) : (
            <SidebarButton />
          )}
          {title && (
            <h2 className="font-semibold text-sm truncate min-w-0">{title}</h2>
          )}
        </>
      }
      right={headerRight}
    />
  )

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <PanelSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="p-6 text-destructive text-sm">Error: {error}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {header}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/shared/DetailView.tsx
git commit -m "feat: add DetailView wrapper component"
```

### Task 6: Tests

**Files:**
- Create: `src/components/shared/__tests__/field-schema-rendering.test.tsx`

- [ ] **Step 1: Write rendering tests**

```tsx
// src/components/shared/__tests__/field-schema-rendering.test.tsx
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
```

- [ ] **Step 2: Run tests**

Run: `cd packages/inbox && npx vitest run src/components/shared/__tests__/field-schema-rendering.test.tsx`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd packages/inbox && npm run test:ci`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/__tests__/field-schema-rendering.test.tsx
git commit -m "test: add schema rendering tests for email and task field schemas"
```

---

## Summary

| Chunk | Tasks | Key Files |
|-------|-------|-----------|
| 1: Schema helpers | Tasks 1-2 | `types/plugin.ts`, `lib/field-schema.ts` |
| 2: FilterPopover + ListView | Tasks 3-4 | `FilterPopover.tsx`, `ListView.tsx` |
| 3: DetailView + Tests | Tasks 5-6 | `DetailView.tsx`, tests |

**Files created:** 6 (including tests)
**Files modified:** 1 (`types/plugin.ts` — add `listRole`)
