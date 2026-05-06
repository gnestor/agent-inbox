# Shared UI Components

## Purpose

Inbox-local presentational primitives that wrap or extend `@hammies/frontend`'s shadcn library: panel chrome (`PanelHeader`, `EmptyState`, `PanelSkeleton`), error boundaries with reset-keys, sidebar shell (`AppSidebar`), property editors (select / combobox / date), filter UI (`FilterCombobox`, `FilterPopover`, `BadgeToggleMenu`), and plumbing the rest of the app shares (`queryClient`, `iframe-theme`, `formatters`, `plugin-utils`, `field-schema`). Stuff that isn't big enough to be its own domain but is wider than any single feature.

## Context

### Why a "shared-ui" bucket
The inbox has ~15 small presentational components that don't belong in `@hammies/frontend` (too inbox-specific) and don't belong in any feature folder (used by 3+ features). Putting them under `src/components/shared/` and giving them one spec keeps the per-feature specs short — feature specs can reference `<PanelHeader>` or `<ErrorBoundary>` without redefining their contracts.

### Why we don't promote everything to `@hammies/frontend`
The frontend package is the cross-app shadcn surface. Components here either depend on inbox-specific state (e.g. `PanelHeader` calls `useDragTab` from the navigation domain) or operate on inbox types (e.g. `PropertyEditor` resolves field options against the API client). Promoting them would either pull inbox concerns up or force a generic abstraction that loses fidelity.

### Why error boundaries take `resetKeys`
React error boundaries don't auto-reset — once caught, the fallback persists until `setState` is called. The inbox places boundaries at three levels (root, tab, plugin); when the user navigates to a different tab, the boundary should clear so the new tab renders fresh. `resetKeys` makes that declarative: pass the active tab id, and `componentDidUpdate` clears the error when it changes.

### Why iframe theme is centralized in `iframe-theme.ts`
HTML outputs, React artifacts, plugin components, and email bodies all render inside sandboxed iframes. Each needs the same set of CSS custom properties forwarded so they pick up the dark/light theme. Centralizing the variable list (`THEME_VARS`) and base CSS (`IFRAME_BASE_CSS`) here means a token rename touches one file rather than four.

### Why `queryClient` config is two settings
`staleTime: 5min` keeps cached queries from refetching on every nav (avoiding the loading flash); `gcTime: 24h` matches the React Query persister's `maxAge` so the persisted cache is never trusted longer than the in-memory cache. Other defaults (retry, refetchOnWindowFocus) are tuned to be quiet.

### What is NOT in scope
- Rich text editor → `rich-text-editor` spec.
- DataTable / ListView (the heavy list layouts) → `data-table-list-views` spec.
- Per-feature views (email reader, session view) → their own specs.
- Navigation primitives (`<PanelSlot>`, `<Tab>`, `<NavigationProvider>`) — wired in `navigation` spec; the chrome they render lives there too.

## Requirements

### Panel chrome

#### Scenario: `<PanelHeader left right>` lays out a 12-tall flex header
- **WHEN** any panel uses the shared chrome
- **THEN** `PanelHeader` renders `h-12 shrink-0 flex items-center justify-between px-4 border-b touch-pan-x`.
- **AND** the `left` slot is a min-width container that truncates; the `right` slot is shrink-0 for action buttons.

#### Scenario: PanelHeader disambiguates horizontal scroll vs vertical tab-drag
- **WHEN** the user starts a pointer drag on the header
- **THEN** the handler watches the first 10 px of movement; if vertical movement dominates, it calls `dragTab.onVerticalDrag(...)` to switch tabs.
- **AND** if the drag starts on a button, link, or input (`target.closest("button, a, input")`), the handler bails — those elements own their own pointer events.
- **WHY:** the panel is a horizontal scroll container; without the dead-zone the user couldn't tap-and-pan without accidentally switching tabs.

#### Scenario: Mobile back button vs sidebar button
- **WHEN** the panel is the first visible panel on mobile
- **THEN** `<SidebarButton>` is shown (opens the sidebar drawer via `useSidebar().setOpenMobile(true)`).
- **AND** otherwise `<BackButton onClick>` is shown so the user can pop back to the previous panel.

#### Scenario: `<PanelSkeleton>` and `<EmptyState>` are minimal
- **WHEN** panel content is loading or empty
- **THEN** the skeleton renders a single muted block; `<EmptyState>` renders centered muted text. Both are deliberately tiny — feature panels supply their own richer skeletons when needed.

### Error boundaries

#### Scenario: `<ErrorBoundary label resetKeys fallback>` catches render errors
- **WHEN** a child component throws during render
- **THEN** `getDerivedStateFromError` captures the error and `componentDidCatch` logs `[ErrorBoundary:<label>]` with the component stack.
- **AND** the default fallback renders a "Something went wrong" card with the error message and a "Try again" button calling `reset()`.

#### Scenario: `resetKeys` change clears the error
- **WHEN** any value in `resetKeys` differs from the previous render
- **THEN** `componentDidUpdate` calls `setState({ error: null })`, restoring the children.
- **AND** the inbox passes `[activeTab]` as resetKeys at the tab boundary so a tab switch always clears prior crashes.

#### Scenario: Three placement levels
- **WHEN** the app mounts
- **THEN** boundaries wrap (1) the entire authenticated app, (2) each tab in the panel grid, (3) every third-party plugin iframe — so a single throw can never blank the whole UI.

### Sidebar

#### Scenario: `<AppSidebar>` renders tabs in plugin order with the active highlight
- **WHEN** the sidebar mounts
- **THEN** it reads `useActiveTab()` and `useSortedPlugins()` and renders Settings, plugin tabs (in user's `pluginOrder` preference), then Sessions and the recent sessions group.
- **AND** the active tab gets `ACTIVE_TAB_CLASSES` which forces primary-color background overriding the default secondary styling.

#### Scenario: Plugin order is reorder-by-drag and persisted via preference
- **WHEN** the user drags a plugin tab to a new position
- **THEN** the new ordering is written via `usePreference<string[]>("pluginOrder", [])`.

#### Scenario: Switching tabs preserves prior URLs per tab
- **WHEN** the user switches tabs
- **THEN** the sidebar caches the previous tab's URL in `savedUrls.current` so clicking back to that tab restores the prior detail view.

### Property and filter editors

#### Scenario: `<PropertySelect>` is a typed shadcn `Select` for status/category
- **WHEN** a single-option editor is needed
- **THEN** the component renders a sized small `Select` with `{ value, color? }` options and calls `onChange(value)` only on actual change.

#### Scenario: `<PropertyCombobox>` supports multi-select with chips
- **WHEN** an editor needs free-text or multi-value editing
- **THEN** the component renders shadcn's `ComboboxChips` with current values as removable chips and an autocomplete input.

#### Scenario: `<PropertyDate>` opens a Calendar popover
- **WHEN** a date editor is needed
- **THEN** the trigger shows the current date formatted via `date-fns`, and selecting a date in the popover calls `onChange(iso)`.

#### Scenario: `<FilterCombobox>` and `<FilterPopover>` drive panel filters
- **WHEN** a list panel exposes filterable columns
- **THEN** these primitives read `useActiveFilters()` from the navigation store and call `setFilter(key, value)` on change; clearing a chip calls `setFilter(key, "")` which strips the key via `cleanFilters`.

#### Scenario: `<BadgeToggleMenu>` is a dropdown-of-toggles for visibility
- **WHEN** the session view needs to toggle which message types render (messages / tool calls / thinking / artifacts)
- **THEN** the badge shows the count of active toggles and the menu lists each toggle as a `Checkbox`.

### Cross-cutting libs

#### Scenario: `queryClient` defaults are 5 min stale, 24 h gc, 1 retry, no focus refetch
- **WHEN** any hook calls `useQuery`
- **THEN** the defaults from `lib/queryClient.ts` apply unless the hook overrides them.
- **AND** `gcTime` MUST be ≥ the React Query persister's `maxAge`; mismatched values were the source of phantom-stale-data bugs in the past.

#### Scenario: `injectIntoHtml(html, themeStyle, trailingScript)` patches HTML before iframe display
- **WHEN** any iframe-based renderer (artifact, plugin component, email body) hands HTML to a sandboxed iframe
- **THEN** the helper inserts the theme `<style>` block before `</head>` (or at end of `</body>` / `</html>` / appended) and a trailing script before `</body>`.
- **AND** the theme variables forwarded come from `THEME_VARS`; the base CSS comes from `IFRAME_BASE_CSS`.

#### Scenario: `getItemTitle/Subtitle/Timestamp` honor `fieldSchema.listRole` first
- **WHEN** a list row needs to extract title/subtitle/timestamp from a generic plugin item
- **THEN** the helpers look for a field with `listRole === "title" | "subtitle" | "timestamp"` first; only if none is declared do they fall back to the `TITLE_KEYS`/`SUBTITLE_KEYS`/`TIMESTAMP_KEYS` heuristic lists.
- **AND** subtitle values are passed through `formatEmailAddress` to strip surrounding `<...>` brackets.
- **WHY:** plugins can be explicit about which field is the title; only legacy plugins without a schema fall through to the heuristic.

#### Scenario: `sessionStatusLabel/Color/BadgeClass` are the single source for status presentation
- **WHEN** any component renders a session status
- **THEN** it imports the corresponding helper from `formatters.ts` rather than hard-coding strings or colors — this is what keeps the same status from being labeled "Needs Attention" in one place and "Attention Needed" in another.

#### Scenario: Logger is the only console emitter for app code
- **WHEN** application code needs to log
- **THEN** it imports `logger` from `lib/logger.ts` rather than calling `console.*` directly so prefixes and levels are uniform.

## Technical Notes

| Concern | Location |
|---|---|
| Panel header chrome and mobile sidebar/back buttons | [src/components/shared/PanelHeader.tsx](../../../src/components/shared/PanelHeader.tsx) |
| Error boundary with resetKeys | [src/components/shared/ErrorBoundary.tsx](../../../src/components/shared/ErrorBoundary.tsx) |
| Empty state, panel/list skeletons | [src/components/shared/EmptyState.tsx](../../../src/components/shared/EmptyState.tsx), [src/components/shared/PanelSkeleton.tsx](../../../src/components/shared/PanelSkeleton.tsx), [src/components/shared/ListSkeleton.tsx](../../../src/components/shared/ListSkeleton.tsx) |
| Property editors (select, combobox, date) | [src/components/shared/PropertyEditor.tsx](../../../src/components/shared/PropertyEditor.tsx) |
| Filter combobox / popover / badge toggle | [src/components/shared/FilterCombobox.tsx](../../../src/components/shared/FilterCombobox.tsx), [src/components/shared/FilterPopover.tsx](../../../src/components/shared/FilterPopover.tsx), [src/components/shared/BadgeToggleMenu.tsx](../../../src/components/shared/BadgeToggleMenu.tsx) |
| Search input, list item, detail view scaffold | [src/components/shared/SearchInput.tsx](../../../src/components/shared/SearchInput.tsx), [src/components/shared/ListItem.tsx](../../../src/components/shared/ListItem.tsx), [src/components/shared/DetailView.tsx](../../../src/components/shared/DetailView.tsx) |
| App sidebar (tabs, plugin order, recent sessions, user menu) | [src/components/layout/AppSidebar.tsx](../../../src/components/layout/AppSidebar.tsx) |
| Login page, liquid-glass filter | [src/components/layout/LoginPage.tsx](../../../src/components/layout/LoginPage.tsx), [src/components/layout/LiquidGlassFilter.tsx](../../../src/components/layout/LiquidGlassFilter.tsx) |
| React Query client defaults | [src/lib/queryClient.ts](../../../src/lib/queryClient.ts) |
| Iframe theme forwarding (`THEME_VARS`, `IFRAME_BASE_CSS`, `injectIntoHtml`) | [src/lib/iframe-theme.ts](../../../src/lib/iframe-theme.ts) |
| Inbox formatters (`getItemTitle`, `formatEmailAddress`, session status helpers) | [src/lib/formatters.ts](../../../src/lib/formatters.ts) |
| Plugin item title/subtitle/timestamp extraction | [src/lib/plugin-utils.ts](../../../src/lib/plugin-utils.ts) |
| Field schema typings shared by plugin views | [src/lib/field-schema.ts](../../../src/lib/field-schema.ts) |
| Browser-side logger | [src/lib/logger.ts](../../../src/lib/logger.ts) |

## History

- Error boundary `resetKeys` added after a single plugin throw left the entire tab in a fallback state until full page reload.
- `injectIntoHtml` extracted to a helper after artifact renderers, plugin components, and email bodies all reimplemented HTML patching with subtly different escape behavior.
- `queryClient` `gcTime` extended from 30 min to 24 h after the persister was added — shorter `gcTime` evicted in-memory entries while persisted ones lingered, causing apparent staleness.
- Plugin item heuristics (`TITLE_KEYS` etc.) marked as fallbacks only after a plugin's `listRole` declaration was being ignored because the heuristic returned a different field first.
