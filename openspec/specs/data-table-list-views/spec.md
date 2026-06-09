# Data Table and List Views

## Purpose

Two data-presentation primitives: `<DataTable>` for tabular results (TanStack Table with sort/filter/paginate auto-enabled by row count) and the compound `<ListView>` family (Header, Search, Filters, Body) that drives every plugin list panel — emails, tasks, sessions, plugin items. List rows are rendered via `<ListItem>` whose appearance is fully derived from a `FieldDef[]` schema (title/subtitle/timestamp/badges) so plugins control their list look without owning components.

## Context

### Why TanStack Table for `<DataTable>`
`<DataTable>` shows arbitrary tabular results — most often the output of agent tools that produce SQL-style rows. TanStack Table gives sort/filter/paginate primitives for free; building these would replicate ~300 lines of state machinery. Auto-enabling features by row count (`searchable` if > 5, `paginated` if > 20) keeps small results clean while letting large ones stay usable.

### Why `<ListView>` is a compound component
Every list panel needs the same skeleton (header + search + filters + scroll body) but wires them differently — sessions sort by status, emails group by thread, plugin items by their schema. Compound subcomponents (`ListView.Header`, `ListView.Search`, `ListView.Filters`, `ListView.Body`) let each consumer compose its own header buttons and search behavior while sharing the body's virtualization and infinite-scroll machinery.

### Why field schemas drive list appearance
Plugins ship a `FieldDef[]` describing what each property is (`text`, `date`, `boolean`, etc.) and how it appears in lists (`listRole: "title" | "subtitle" | "timestamp" | "hidden"`, `badge: { show, variant, labelFn, colorFn }`). The list body looks up which field plays which role and renders accordingly — no plugin-specific list components, no list code per plugin. New plugins just declare their schema. The timestamp field is formatted with `formatRelativeDate` by default; a list may pass `<ListView formatTimestamp={fn}>` to override the display format (e.g. the Gmail list uses a compact mail-client format).

### Why `IntersectionObserver` for infinite scroll
Scroll-position math is fragile across mobile/desktop and tab switches. An invisible sentinel `<div>` at the bottom of the list, observed by `IntersectionObserver` with a 200 px `rootMargin`, fires `loadMore` exactly when the user is approaching the end. The pattern survives unmounts (observer disconnect on cleanup) and resize without per-tick recalculation.

### Why `contentVisibility: auto` on each row
Lists frequently exceed 1,000 items. CSS containment + `contentVisibility: auto` lets the browser skip layout/paint for off-screen rows without us having to virtualize manually. The `containIntrinsicSize: auto <itemHeight>px` hint gives a placeholder size so scrollbar geometry is correct before items render.

### Why `<ListItem>` is `memo`d with a custom comparator
Selection-state changes flip every visible row through the same parent re-render. A naive memo on `ListItem` would still re-run because `onClick` is a new closure per row per render. The comparator skips `onClick` (inline closures resolve to the same destination as long as `title/subtitle/timestamp/isSelected/badges` are unchanged) and skips `icon` (currently unused), keeping list re-renders cheap.

### Why `extractFieldValue` accepts dot paths
Plugin items often nest values (`author.name`, `metadata.priority`). A dot-path extractor lets the schema reference nested fields without forcing plugins to flatten their data — and without us reaching for `lodash.get`.

### What is NOT in scope
- Filter/search store wiring → `navigation` spec (`useActiveFilters`, `setFilter`).
- Per-plugin views beyond list rendering → `plugin-system` and per-plugin specs.
- Detail-panel layout → `shared-ui-components` (`<DetailView>`) or feature specs.

## Requirements

### `<DataTable>`

#### Scenario: Auto-enables search above 5 rows, pagination above 20
- **WHEN** `<DataTable columns rows>` is rendered without explicit `searchable`/`paginated` props
- **THEN** `searchable` defaults to `rows.length > 5` and `paginated` defaults to `rows.length > pageSize` (default 20).
- **AND** explicit props override the defaults in either direction.

#### Scenario: Cells render `null`/`undefined` as a muted em-dash
- **WHEN** a row's cell value is `null` or `undefined`
- **THEN** the cell renders `—` in `text-muted-foreground` rather than an empty cell, so missing data is distinguishable from empty strings.

#### Scenario: Sortable column headers
- **WHEN** the user clicks a column header
- **THEN** TanStack `column.toggleSorting(column.getIsSorted() === "asc")` runs, cycling through asc → desc → unsorted.

#### Scenario: Empty/no-results state
- **WHEN** the filtered row model is empty
- **THEN** a single row spans all columns with the centered message "No results".

#### Scenario: Pagination footer shows count and chevrons
- **WHEN** pagination is active
- **THEN** the footer shows `<filteredCount> row[s]` on the left and prev/next chevrons + page indicator (`current / total`) on the right.
- **AND** prev/next are `disabled` when at the first/last page (TanStack's `getCanPreviousPage()` / `getCanNextPage()`).

### `<ListView>` compound

#### Scenario: Root provides items, schema, selection via context
- **WHEN** `<ListView items fieldSchema getItemId selectedId onSelect>` mounts
- **THEN** the context exposes those values to subcomponents; using a subcomponent outside the root throws a useful error.

#### Scenario: `ListView.Header` integrates with `PanelHeader`
- **WHEN** the consumer adds `<ListView.Header title>` with optional action `children`
- **THEN** the header renders the shared `<PanelHeader>` chrome with `<SidebarButton>` (mobile) and the title on the left, and `children` on the right.

#### Scenario: `ListView.Search` is controlled
- **WHEN** the consumer adds `<ListView.Search value onSearch>`
- **THEN** the input is fully controlled by the parent — the list view doesn't own search state, the consumer wires it to its data fetch.

#### Scenario: `ListView.Filters` reads filter fields from the schema
- **WHEN** `<ListView.Filters activeFilters onFilterChange optionsFetcher?>` is rendered
- **THEN** the popover lists every field with `filter.filterable === true` and emits `onFilterChange(key, value)` per change.
- **AND** the `optionsFetcher` map is consulted for fields whose options are dynamic (e.g. plugin-provided enums fetched lazily).

#### Scenario: `ListView.Body` renders rows derived from the schema
- **WHEN** the body mounts
- **THEN** for each item, title comes from `getTitleField()`, subtitle from `getSubtitleField()`, timestamp from `getTimestampField()` (formatted via `formatRelativeDate`), and badges from `getBadgeFields()` mapped through their `badge.labelFn` / `badge.colorFn`.
- **AND** schema fallbacks apply: title is the first non-hidden `text` field, subtitle is the second, timestamp is the first `date` field.

#### Scenario: `badge.show: "if-set"` hides empty values
- **WHEN** a badge field has `show: "if-set"` and the value is falsy
- **THEN** the badge is omitted entirely.
- **AND** boolean badges only render when truthy (no "false" pill).

#### Scenario: `hiddenBadgeFields` lets the consumer suppress per-row badges
- **WHEN** the consumer passes `hiddenBadgeFields: Set<string>`
- **THEN** any badge whose field id is in the set is skipped — used to deduplicate badges that are already shown elsewhere in the panel header.

#### Scenario: Infinite scroll via `IntersectionObserver`
- **WHEN** `hasMore` is true and `loadMore` is provided
- **THEN** a sentinel div is observed with `rootMargin: "200px"`; intersecting fires `loadMore` (read through a ref so stale closures don't queue old requests).
- **AND** the observer disconnects on cleanup or when `hasMore`/`loading` flips.

#### Scenario: `contentVisibility: auto` is applied per row
- **WHEN** the body renders rows
- **THEN** each row wrapper has `style={{ contentVisibility: "auto", containIntrinsicSize: \`auto ${itemHeight}px\` }}` so off-screen rows skip layout/paint while reserving their height.

#### Scenario: Empty / loading / error states
- **WHEN** `loading` is true → render `<ListSkeleton itemHeight>`.
- **WHEN** `error` is set → render `errorContent` if provided, else `<div>{error}</div>` in destructive color.
- **WHEN** `items.length === 0` and not loading/erroring → render `<EmptyState icon message>` (icon defaults to `Bot`).

### `<ListItem>` rendering

#### Scenario: Two-row layout with subtitle, single-row without
- **WHEN** `subtitle` is provided
- **THEN** row 1 is `[subtitle, timestamp]`, row 2 is the title.
- **AND** when no subtitle is provided, row 1 is `[title, timestamp]` only.

#### Scenario: Selected styling overrides badge colors
- **WHEN** `isSelected` is true
- **THEN** the row uses `bg-primary text-primary-foreground` and badges flip to `!bg-primary-foreground/20 !text-primary-foreground` regardless of their custom `colorFn` output.

#### Scenario: Custom memo comparator skips `onClick` and `icon`
- **WHEN** the parent re-renders with a new `onClick` closure but identical visible props
- **THEN** the memoized `ListItem` does NOT re-render.
- **WHY:** lists routinely have hundreds of rows; per-row re-renders driven only by closure identity were the dominant cost before this comparator landed.

### Field schema helpers

#### Scenario: `getTitleField` / `getSubtitleField` / `getTimestampField` honor explicit listRole first
- **WHEN** a schema declares `listRole: "title"` etc. on any field
- **THEN** that field wins over the type-based heuristic.
- **AND** subtitle never returns the title field (deduped by id).

#### Scenario: `extractFieldValue` walks dot paths
- **WHEN** `extractFieldValue(item, "author.name")` is called
- **THEN** it descends through `item.author.name`, returning `undefined` at any null/non-object segment without throwing.

## Technical Notes

| Concern | Location |
|---|---|
| `<DataTable>` columns/rows/sort/filter/paginate | [src/components/shared/DataTable.tsx](../../../src/components/shared/DataTable.tsx) |
| `<ListView>` compound (Root, Header, Search, Filters, Body) and `IntersectionObserver` infinite scroll | [src/components/shared/ListView.tsx](../../../src/components/shared/ListView.tsx) |
| `<ListItem>` rendering, custom memo comparator, badge styling | `src/components/shared/ListItem.tsx` |
| Field-schema helpers (`getTitleField`, `getBadgeFields`, `extractFieldValue`, ...) | `src/lib/field-schema.ts` |

## History

- `<DataTable>` started with manual sort/filter/paginate; replaced with TanStack Table after the third reimplementation of "I want this column sortable" in different consumers.
- `IntersectionObserver` infinite scroll replaced a `scroll`-event handler that misfired on rubber-band scrolling and during panel transitions.
- `contentVisibility: auto` added after long lists (≥ 2,000 plugin items) hung the main thread on layout for several seconds; the CSS hint dropped initial paint to under a frame.
- `<ListItem>` memo comparator added after a profiler showed every list item re-rendering on every keystroke in the search input.
- Schema-driven badge rendering replaced per-plugin custom list components after the third "I want a status badge in my list" feature request.
