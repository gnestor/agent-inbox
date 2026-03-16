# Phase 2.5: Navigation System Redesign — Design Spec

## Context

The current spatial navigation system (PanelStack.tsx, 891 lines) handles tabs, panels, animations, scroll management, mobile gestures, and session state persistence in a single file. Every new feature (settings page, session rename, attach-to-session, integrations) has caused navigation regressions because components reach into PanelStack internals or make assumptions about URL parsing.

Phase 4 (Rich Outputs + Artifacts) requires opening ephemeral panels alongside sessions. Phase 5 (Source Plugins) needs any source to render identically. Both require a navigation system that's composable rather than monolithic.

**Goal:** Abstract the navigation into a small set of composable components (`Tab`, `Panel`, `ListView`, `DetailView`) and a centralized state manager (`useNavigation`) so that every part of the app uses navigation the same way, every time.

---

## Core Data Model

The full navigation state is a serializable data structure persisted in browser storage.

```typescript
interface NavigationState {
  activeTab: TabId
  tabs: Record<TabId, TabState>
}

interface TabState {
  selectedItemId?: string
  panelScrollOffset: number      // horizontal scroll offset of the panel container
  panels: PanelState[]           // ordered left-to-right
  activeFilters?: Record<string, string>  // filter selections for the list panel
}

// Discriminated union — each panel type has typed props
type PanelState =
  | { id: string; type: "list"; props: {} }
  | { id: string; type: "detail"; props: { itemId: string } }
  | { id: string; type: "session"; props: { sessionId: string } }
  | { id: string; type: "artifact"; props: { sessionId: string; sequence: number; outputType: string } }
  | { id: string; type: "compose"; props: { threadId: string; draftBody?: string } }
  | { id: string; type: "settings"; props: {} }

type TabId = "emails" | "tasks" | "calendar" | "sessions" | "settings"
type PanelType = PanelState["type"]
```

### Key properties

- `panels` is an ordered array — position determines horizontal layout
- Every PanelState is serializable (no React elements, no functions)
- Source tabs (emails, tasks, calendar, sessions) have a list panel at `panels[0]`. Other tabs (settings) may have arbitrary panel stacks.
- Full state persisted to IndexedDB (same store as TanStack Query cache)
- `activeFilters` stored per-tab so filter selections survive tab switches and page refresh

### URL mapping

URL encodes only `activeTab` + `selectedItemId`. Panel stack comes from storage.

| URL | Meaning |
|-----|---------|
| `/emails` | Emails tab, list only |
| `/emails/abc123` | Emails tab, item abc123 selected |
| `/sessions` | Sessions tab, list only |
| `/settings/integrations` | Settings tab |
| `/plugins/:id` | Plugin tab (dynamic) |
| `/recent/:sessionId` | Sessions tab, recent session selected (sidebar shortcut) |

Direct URL entry (bookmark, shared link) loads default panel stack for that item. Returning user gets full panel stack restored from storage.

---

## Component API

### Tab

Renders a horizontal row of panels within a slot in the tab grid. Manages horizontal scroll, scroll position persistence, and item-change animation.

```tsx
interface TabProps {
  id: TabId
  children: React.ReactNode  // Panel components
}
```

**Responsibilities:**
- Horizontal scroll container with `overflow-x-auto`
- Scroll new panels into view when `panels` array grows (smooth scroll)
- Save/restore `panelScrollOffset` per tab on tab switches
- Run vertical slide animation via `PanelSlot` when panel content changes at the same slot (e.g., item change)
- Intercept horizontal wheel events on inner panels and redirect to outer scroll container

**Does NOT handle:** Tab switching animation (parent handles that), data fetching, content rendering.

### Panel

Thin container with card styling. Has no knowledge of navigation state.

```tsx
interface PanelProps {
  id: string
  variant?: PanelType
  width?: number               // default 600, overridable for future needs
  children: React.ReactNode
}
```

Default width: 600px for all variants. The `width` prop allows future panel types (e.g., wide artifact viewer) to override.

**Styling:** `shrink-0 h-full bg-card rounded-lg shadow-sm ring-1 ring-inset ring-border overflow-hidden` + `width` from prop.

**Panel does NOT:** Animate, manage scroll, know about navigation, handle scroll-into-view (Tab does that).

### PanelSlot

AnimatePresence wrapper for vertical item transitions within a tab.

```tsx
interface PanelSlotProps {
  panelId: string              // keyed by this — when it changes, vertical slide
  direction: number            // 1 (down) or -1 (up), from list index change
  children: React.ReactNode
}
```

When `panelId` changes (e.g., detail panel for EmailA → EmailB), PanelSlot animates the outgoing panel off-screen and the incoming panel in from off-screen, matching the tab switch animation pattern.

### useNavigation Hook

The only way to read or modify navigation state.

```tsx
interface UseNavigation {
  activeTab: TabId
  switchTab: (tab: TabId) => void

  // Panel stack operations
  pushPanel: (panel: PanelState) => void
  popPanel: (panelId: string) => void
  replacePanel: (panelId: string, newPanel: PanelState) => void

  // Read state
  getPanels: (tab?: TabId) => PanelState[]
  getSelectedItemId: (tab?: TabId) => string | undefined

  // Item selection
  // - If no detail panel exists, pushes one at panels[1]
  // - If a detail panel exists, replaces it (and pops any panels after it)
  // - listIndex is optional — used for animation direction
  selectItem: (itemId: string, listIndex?: number) => void
  deselectItem: () => void

  // Session convenience (common flow from detail views)
  openSession: (sessionId?: string) => void  // pushes session panel; undefined = new session

  // Filters
  activeFilters: Record<string, string>
  setFilter: (key: string, value: string) => void
  clearFilters: () => void
}
```

**`selectItem` behavior:**
1. Sets `selectedItemId` on the active tab
2. If `panels[1]` exists and is a `"detail"` panel → replaces it with the new item; removes all panels after index 1 (session, artifact, compose panels for the old item)
3. If `panels[1]` does not exist → pushes a new detail panel at position 1
4. If `listIndex` is provided → stores direction for PanelSlot animation

**`openSession` behavior:**
1. If `sessionId` is undefined → pushes `{ type: "session", props: { sessionId: "new" } }` (new session)
2. If `sessionId` is provided → pushes `{ type: "session", props: { sessionId } }`
3. If a session panel already exists in the stack → replaces it

State changes trigger:
1. In-memory state update (immediate)
2. Debounced write to IndexedDB (100ms)
3. URL update (activeTab + selectedItemId only)

---

## Schema-Driven ListView and DetailView

### FieldDef (extended from SourcePlugin spec)

The existing `FieldDef` in `src/types/plugin.ts` gains one new field for list rendering:

```typescript
export interface FieldDef {
  id: string
  label: string
  type: FieldType

  filter?: FilterConfig
  badge?: BadgeConfig
  detailWidget?: WidgetDef

  // NEW: list view role (optional — inferred from type if omitted)
  listRole?: "title" | "subtitle" | "timestamp" | "hidden"
}
```

When `listRole` is omitted, ListView infers:
- First `text` field → title
- Second `text` field → subtitle
- First `date` field → timestamp
- Fields with `badge` config → badges
- Fields with `filter` config → filter popover

### ListView

```tsx
interface ListViewProps<T extends Record<string, unknown>> {
  title: string
  icon?: string
  items: T[]
  loading?: boolean
  error?: string | null

  // Schema-driven rendering
  fieldSchema: FieldDef[]

  // Item identity
  getItemId: (item: T) => string

  // Selection
  selectedId?: string
  onSelect: (id: string, index: number) => void  // index for animation direction

  // Virtualization
  itemHeight?: number              // default 76

  // Search
  searchPlaceholder?: string
  onSearch?: (query: string) => void   // server-side search
  localSearch?: (item: T, query: string) => boolean  // client-side filter

  // Pagination
  hasMore?: boolean
  loadMore?: () => void

  // Header extras
  headerRight?: React.ReactNode
}
```

**`onSelect` includes `index`** — ListView knows the list index of the clicked item and passes it to the callback. This enables animation direction tracking without the list needing to know about the navigation system.

**What ListView handles:** PanelHeader, search input, filter popover (from schema), virtualizer, ListItem rendering, loading/error/empty states, infinite scroll.

**What ListView does NOT handle:** Data fetching, navigation, panel management.

**Built-in source example (Gmail):**

```tsx
const emailFieldSchema: FieldDef[] = [
  { id: "from", label: "From", type: "text", listRole: "title" },
  { id: "subject", label: "Subject", type: "text", listRole: "subtitle" },
  { id: "date", label: "Date", type: "date", listRole: "timestamp" },
  { id: "labels", label: "Labels", type: "multiselect",
    badge: { show: "if-set", variant: "secondary" },
    filter: { filterable: true, filterType: "multiselect" } },
  { id: "isUnread", label: "Unread", type: "boolean",
    badge: { show: "if-set", variant: "default" } },
  { id: "body", label: "Body", type: "html", listRole: "hidden" },
]

// EmailListView.tsx — ~40 lines instead of ~240
function EmailListView() {
  const { data, loading, hasMore, loadMore } = useEmails(filters)
  const { selectItem, getSelectedItemId } = useNavigation()

  return (
    <ListView<EmailThread>
      title="Emails"
      items={data?.threads ?? []}
      loading={loading}
      fieldSchema={emailFieldSchema}
      getItemId={(t) => t.threadId}
      selectedId={getSelectedItemId()}
      onSelect={(id, index) => selectItem(id, index)}
      hasMore={hasMore}
      loadMore={loadMore}
    />
  )
}
```

### DetailView

```tsx
interface DetailViewProps<T extends Record<string, unknown>> {
  title?: string
  item?: T
  loading?: boolean
  error?: string | null

  // Schema-driven detail layout
  fieldSchema?: FieldDef[]        // auto-generates detail widgets
  detailSchema?: WidgetDef[]      // explicit widget layout (overrides fieldSchema)

  // Header actions
  headerRight?: React.ReactNode

  // Custom content (overrides schema-driven layout)
  children?: React.ReactNode
}
```

**Three rendering modes:**
1. `children` provided → custom content (complex views like EmailThread)
2. `detailSchema` provided → explicit widget tree
3. Only `fieldSchema` → auto-generated from field types (html → prose, text → kv-table, etc.)

---

## Plugin Views and Recent Sessions

### Plugin tabs (dynamic)

Plugins register as dynamic tabs via `useNavigation`. The `TabId` type includes a string escape hatch for plugin IDs:

```typescript
type TabId = "emails" | "tasks" | "calendar" | "sessions" | "settings" | `plugin:${string}`
```

Plugin views use the same Tab/Panel/ListView components:

```tsx
function PluginTab({ plugin }: { plugin: PluginManifest }) {
  const { getPanels } = useNavigation()
  const panels = getPanels(`plugin:${plugin.id}`)

  return (
    <Tab id={`plugin:${plugin.id}`}>
      {panels.map(panel => (
        <Panel key={panel.id} id={panel.id} variant={panel.type}>
          <PanelContent panel={panel} />
        </Panel>
      ))}
    </Tab>
  )
}
```

**During migration:** Constants currently exported from PanelStack (`PANEL_CARD`, `EASE`, `DURATION`) are re-exported from the new navigation module so PluginView does not break before it's migrated.

### Recent sessions (sidebar)

Recent sessions in the sidebar navigate to the sessions tab with the selected session:

```tsx
// Clicking a recent session in the sidebar:
switchTab("sessions")
selectItem(sessionId)
```

This replaces the current `/recent/:sessionId` route. The sessions tab restores its panel stack with the selected session detail. No separate RecentPane component needed — it's just a sessions tab with a selected item.

---

## State Persistence

### Storage

IndexedDB via `idb-keyval` (same store as TanStack Query cache). Key: `"navigation-state"`.

### Three levels of persistence

| Level | What | Survives tab switch | Survives item change | Survives page refresh |
|-------|------|--------------------|--------------------|---------------------|
| **Tab** | Active tab, scroll position, filters | ✅ | ✅ | ✅ |
| **Item** | Panel stack for a selected item | ✅ | Only for that item | ✅ |
| **Panel** | Draft content, artifact state | ✅ | ✅ (within its item) | ✅ |

### Panel state serialization

Typed discriminated union — each panel type has known props:

```typescript
{ id: "list", type: "list", props: {} }
{ id: "detail:abc", type: "detail", props: { itemId: "abc123" } }
{ id: "session:xyz", type: "session", props: { sessionId: "xyz789" } }
{ id: "artifact:xyz:3", type: "artifact", props: { sessionId: "xyz789", sequence: 3, outputType: "chart" } }
{ id: "compose:abc", type: "compose", props: { threadId: "abc123", draftBody: "Hi..." } }
```

### Page load restoration

1. Read `NavigationState` from IndexedDB
2. Validate restored state: remove panels with unknown types, check that TabIds are valid
3. If valid → restore active tab, panel stacks, scroll positions, filters
4. Navigate to URL matching restored state (`replace`, not `push`)
5. If not found or invalid → default state (emails tab, list panel only)

### Stale state handling

`PanelContent` must handle "item not found" gracefully — if a persisted panel references a deleted session or archived email, the content component shows an appropriate empty/error state rather than crashing. `NavigationProvider` does not validate item existence (that's a data concern, not a navigation concern).

### Storage migration

On first load, `NavigationProvider` checks for the old `localStorage["spatial-nav-state"]` format. If found:
- `pathname` → derive `activeTab` and `selectedItemId`
- `tabs[tabId].selectedId` → convert to `panels: [{ type: "list" }, { type: "detail", props: { itemId } }]`
- `itemSessions` entries → add session panels to the corresponding item's panel stack
- Write to IndexedDB, delete old localStorage key

If migration fails → clear state and start fresh (better than broken navigation).

### Debounced persistence

State changes write to IndexedDB with 100ms debounce. No write on every keystroke — only after state settles.

---

## Animations

### Preserved from current system

| Animation | Trigger | Direction | Implementation |
|-----------|---------|-----------|----------------|
| **Tab switch** | `activeTab` changes | Vertical (up/down by tab index) | `AnimatePresence` + Framer Motion, `cubic-bezier(0.32, 0.72, 0, 1)` at 600ms |
| **Item change** | `selectedItemId` changes within a tab | Vertical (up/down by list index) | `PanelSlot` with `AnimatePresence` keyed by panel id |
| **Panel push** | `panels.length` grows | Horizontal smooth scroll to new panel | `scrollIntoView({ behavior: "smooth", inline: "end" })` |
| **Panel pop** | `panels.length` shrinks | Horizontal smooth scroll left | Native scroll adjustment |

### Item change animation direction

`selectItem(itemId, listIndex)` stores the list index. Tab computes direction by comparing new index vs previous index:

```typescript
// Inside Tab:
const directionRef = useRef(1)
useEffect(() => {
  if (prevIndexRef.current !== undefined && currentIndex !== undefined) {
    directionRef.current = currentIndex > prevIndexRef.current ? 1 : -1
  }
  prevIndexRef.current = currentIndex
}, [currentIndex])
```

This is passed to `PanelSlot` for the vertical animation. ListView provides the index via `onSelect(id, index)`.

### PanelSlot animation model

Tab manages a `PanelSlot` for each position in the panel stack. When the panel id at a position changes, PanelSlot runs the vertical transition — outgoing panel slides off-screen, incoming slides in from off-screen:

```tsx
// Inside Tab:
{panels.map((panel, index) => (
  <PanelSlot key={index} panelId={panel.id} direction={directionRef.current}>
    <Panel id={panel.id} variant={panel.type} width={panel.width}>
      <PanelContent panel={panel} />
    </Panel>
  </PanelSlot>
))}
```

### Mobile

- Overlay model preserved: panels slide in from right
- Swipe right to dismiss (pop panel)
- Swipe left to go forward (if default next panel exists)
- Tab header swipe (vertical) unchanged

---

## Migration Strategy

### Incremental — one tab at a time

1. Build `NavigationProvider`, `Tab`, `Panel`, `PanelSlot`, `useNavigation`
2. Build `ListView`, `DetailView`, `FilterPopover`
3. Re-export `PANEL_CARD`, `EASE`, `DURATION` from navigation module (PluginView compat)
4. Migrate Sessions tab first (simplest — no sub-item sessions)
5. Migrate Emails tab (most complex — has session panels)
6. Migrate Tasks, Calendar
7. Migrate Settings (already a single panel)
8. Migrate PluginView
9. Migrate RecentPane → sidebar navigates to sessions tab
10. Remove old PanelStack, use-spatial-nav, use-header-nav

During migration, both systems coexist. The `NavigationProvider` wraps the entire app. Old tabs use PanelStack; migrated tabs use Tab/Panel.

### Compatibility

- Storage migration reads old `localStorage["spatial-nav-state"]`, converts to new `NavigationState` in IndexedDB
- URL format stays the same (`/emails/{id}`) — no breaking changes for bookmarks
- `ListItem.tsx` stays as-is — ListView uses it internally

---

## File Structure

```
src/
├── components/
│   ├── navigation/
│   │   ├── NavigationProvider.tsx    — context + state management + persistence
│   │   ├── Tab.tsx                  — horizontal panel row + scroll + item animation
│   │   ├── Panel.tsx                — thin card container
│   │   ├── PanelSlot.tsx            — AnimatePresence wrapper for item transitions
│   │   └── PanelContent.tsx         — maps PanelState → React component
│   ├── shared/
│   │   ├── ListView.tsx             — schema-driven virtualized list
│   │   ├── DetailView.tsx           — schema-driven detail layout
│   │   ├── FilterPopover.tsx        — schema-driven filter UI (from FieldDef)
│   │   ├── ListItem.tsx             — (existing, unchanged)
│   │   └── PanelHeader.tsx          — (existing, unchanged)
│   ├── email/
│   │   ├── EmailTab.tsx             — wires EmailListView + EmailDetailView into Tab
│   │   ├── EmailListView.tsx        — ~40 lines: data fetch + fieldSchema + ListView
│   │   └── EmailDetailView.tsx      — ~60 lines: data fetch + custom children in DetailView
│   ├── task/
│   │   ├── TaskTab.tsx
│   │   ├── TaskListView.tsx
│   │   └── TaskDetailView.tsx
│   ├── session/
│   │   ├── SessionTab.tsx
│   │   ├── SessionListView.tsx
│   │   └── SessionView.tsx          — (existing, minor changes)
│   ├── plugin/
│   │   └── PluginTab.tsx            — (migrated from PluginView, uses Tab/Panel/ListView)
│   └── settings/
│       └── IntegrationsPage.tsx     — (existing, wrapped in Panel)
├── hooks/
│   └── use-navigation.ts            — public hook (reads from NavigationProvider)
├── types/
│   ├── navigation.ts                — NavigationState, TabState, PanelState, PanelType, TabId
│   └── plugin.ts                    — FieldDef gains listRole field
└── lib/
    ├── navigation-storage.ts        — IndexedDB read/write + migration from localStorage
    └── navigation-constants.ts      — PANEL_CARD, EASE, DURATION (re-exported for compat)
```

---

## What Gets Deleted

After full migration:
- `src/components/layout/PanelStack.tsx` (891 lines)
- `src/hooks/use-spatial-nav.tsx` (245 lines)
- `src/hooks/use-header-nav.ts` (11 lines)
- `src/components/session/RecentPane.tsx` (replaced by sessions tab selection)
- Individual list components collapse from ~240 lines each to ~40 lines each

**Net reduction:** ~1,200 lines removed, ~700 lines added = ~500 lines net reduction with better abstractions.

---

## Testing Strategy

### Unit tests
- `NavigationProvider`: state transitions (selectItem, pushPanel, popPanel, replacePanel), persistence round-trip, URL sync, storage migration from old format
- `ListView`: schema-driven rendering (FieldDef → title/badges/filters), virtualizer integration, onSelect with index
- `DetailView`: three rendering modes (children, detailSchema, fieldSchema)
- `PanelSlot`: animation direction from index changes

### E2e tests (Playwright)
- Tab switching preserves panel stacks
- Item selection restores panel stack on return
- Panel push/pop with scroll behavior
- Page refresh restores full state (panels, filters, scroll position)
- Draft persistence across tab switches
- "Open Session" from email detail pushes session panel
- Plugin tab renders with Tab/Panel/ListView

### Migration verification
- Each tab migrated independently — verify before moving to next
- Playwright tests run against each migrated tab
- PluginView continues working during incremental migration (via re-exported constants)
