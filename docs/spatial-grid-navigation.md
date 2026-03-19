# Spatial Grid Navigation

The inbox uses a 2D spatial canvas for navigation. The vertical axis represents top-level tabs (Emails, Tasks, Calendar, Sessions, Settings). The horizontal axis represents panels within each tab (list → detail → session). The viewport clips to one cell at a time — switching tabs scrolls the canvas vertically, and selecting an item slides the detail panel in with a CSS keyframe animation.

```
          ← panels (horizontal) →
          List       Detail      Session
    ↑  ┌──────────┬───────────┬──────────┐
       │ Email    │ Thread    │ New      │  /emails  /emails/:id
  tabs │ list     │ view      │ session  │
  (vert│──────────┼───────────┼──────────┤
  ical)│ Task     │ Task      │ New      │  /tasks  /tasks/:id
       │ list     │ detail    │ session  │
       │──────────┼───────────┼──────────┤
       │ Calendar │ Calendar  │ New      │  /calendar  /calendar/:id
       │ list     │ detail    │ session  │
    ↓  │──────────┼───────────┼──────────┤
       │ Session  │ Session   │          │  /sessions  /sessions/:id
       │ list     │ view      │          │
       └──────────┴───────────┴──────────┘
```

## Key files

| File | Role |
|------|------|
| `src/types/navigation.ts` | `NavigationState`, `TabState`, `PanelState`, `TabId` types |
| `src/components/navigation/NavigationProvider.tsx` | Context provider, reducer, URL sync, IndexedDB persistence |
| `src/hooks/use-navigation.ts` | Public hook: `switchTab`, `selectItem`, `deselectItem`, `pushPanel`, `popPanel`, etc. |
| `src/components/navigation/SlotStack.tsx` | Vertical scroll container for tab transitions (native `scrollTop`) |
| `src/components/navigation/PanelSlot.tsx` | CSS `@keyframes` animation for detail panel transitions |
| `src/components/navigation/Tab.tsx` | Desktop (horizontal scroll) and Mobile (horizontal scroll-snap) panel layout |
| `src/components/navigation/Panel.tsx` | Card container (styling only) |
| `src/lib/navigation-constants.ts` | `EASE`, `DURATION`, `ITEM_GAP`, `DEFAULT_PANEL_WIDTH` |
| `src/lib/navigation-storage.ts` | IndexedDB persistence + localStorage migration |
| `src/components/layout/AppSidebar.tsx` | Sidebar nav items, calls `switchTab()` |

## URL schema

The URL encodes only `activeTab` and `selectedItemId`. The full panel stack lives in `NavigationState` (persisted to IndexedDB).

```
/emails                    → email list
/emails/:threadId          → email list + thread detail
/tasks                     → task list
/tasks/:taskId             → task list + task detail
/calendar/:itemId          → calendar list + item detail
/sessions/:sessionId       → session list + session view
/settings/integrations     → settings page
/plugins/:pluginId         → plugin view
```

URL is **derived from state**, not the other way around. A single declarative effect in `NavigationProvider` syncs `state.activeTab` + `state.tabs[activeTab].selectedItemId` → URL. A separate effect handles browser back/forward by parsing the URL and dispatching to the reducer.

## State management

### NavigationState (reducer)

```ts
interface NavigationState {
  activeTab: TabId
  tabs: Record<string, TabState>
}

interface TabState {
  selectedItemId?: string
  panels: PanelState[]           // [list, detail?, session?]
  activeFilters?: Record<string, string>
  itemDirection?: number         // 1 (down) or -1 (up), computed by reducer
  prevListIndex?: number         // for direction calculation
}
```

All navigation actions go through `dispatch()` — no imperative `navigate()` calls in hooks. The `useNavigation()` hook exposes only dispatch-based functions:

- `switchTab(tabId)` → `dispatch({ type: "SWITCH_TAB" })`
- `selectItem(itemId, listIndex?)` → `dispatch({ type: "SELECT_ITEM" })` (computes direction in reducer)
- `deselectItem()` → `dispatch({ type: "DESELECT_ITEM" })`
- `pushPanel(panel)` / `popPanel(panelId)` / `replacePanel(id, panel)`
- `openSession(sessionId?)` → `dispatch({ type: "OPEN_SESSION" })`
- `getSelectedItemId(tabId?)` — **must pass tab ID explicitly** to avoid reading wrong tab during transitions
- `getItemDirection(tabId?)` — reads `TabState.itemDirection` (no mutable refs)

### Persistence

State is debounced (100ms) to IndexedDB via `idb-keyval`. On mount, loads from IndexedDB or migrates from old `localStorage` format (`spatial-nav-state` key).

### Tab-scoped reads

List views **must** pass their tab ID to `getSelectedItemId("emails")` rather than using the default (which reads `activeTab`). Without this, switching tabs causes the outgoing list to lose its selection highlight before the transition animation plays.

## Tab transitions — SlotStack

`SlotStack` renders all tabs in a vertical column using native `scrollTop` positioning:

- **Initial**: `scrollTop` set synchronously in a ref callback (before first paint)
- **Tab switch**: `scrollTo({ top: idx * clientHeight, behavior: "smooth" })` — native smooth scroll
- **Resize**: `ResizeObserver` sets `scrollTop = idx * clientHeight` instantly (no animation)
- **No pixel offsets in React state** — `scrollTop` is always live and accurate

Each tab slot is wrapped in `MemoizedSlot` (`React.memo`) that only re-renders when the slot becomes/stops being the active tab. This prevents non-active tabs from re-rendering during tab switches.

```tsx
<SlotStack activeKey={activeTab} keys={TAB_SLOTS} renderItem={renderTab} />
```

## Item transitions — PanelSlot

`PanelSlot` animates between detail panels using CSS `@keyframes`. When `panelId` changes:

1. Old content is cached and rendered with an **exit** animation class
2. New content renders with an **enter** animation class
3. Both play simultaneously — CSS keyframes start on the next frame after DOM commit (no `requestAnimationFrame` needed)
4. `onAnimationEnd` on the exiting panel triggers cleanup (no `setTimeout` needed)

Direction determines animation:
- `direction >= 0` (selecting item below): enter from bottom, exit to top
- `direction < 0` (selecting item above): enter from top, exit to bottom

```css
@keyframes panel-slide-in-up {
  from { transform: translateY(calc(100% + 16px)); }
  to { transform: translateY(0); }
}
@keyframes panel-slide-out-up {
  from { transform: translateY(0); }
  to { transform: translateY(calc(-100% - 16px)); }
}
/* Reverse for direction < 0 */
```

Rapid clicks are handled naturally: setting a new `exiting` panel replaces the previous one (React unmounts the old node, killing its animation).

### Children caching

`PanelSlot` caches children by `panelId` in a `Map<string, ReactNode>`. When `panelId` changes from A to B, the exit animation renders A's cached content while the enter animation renders B's current children. Cache entries are cleaned up in `onAnimationEnd`.

## Desktop panel layout — Tab (DesktopTab)

Horizontal scroll container with side-by-side panel cards:

- Saves/restores `scrollLeft` when switching tabs
- Auto-scrolls right when panel count increases (detail panel opens)
- **Exit animation**: collapsing panel width + opacity fade via CSS transition when a panel is removed
- Wheel event interception redirects horizontal scroll from inner panels to the outer container

## Mobile panel layout — Tab (MobileTab)

Horizontal `scroll-snap` for panels:

- `scroll-snap-type: x mandatory` with `scrollTo({ behavior: "smooth" })`
- Vertical drag gesture (60px threshold) switches tabs via `switchTab()`
- `useExitChildren` hook keeps outgoing panel content in DOM during collapse animation

## Direction tracking

Direction is computed **in the reducer** (not via mutable refs) when `SELECT_ITEM` includes a `listIndex`:

```ts
// In navReducer, SELECT_ITEM case:
if (action.listIndex !== undefined) {
  const prev = tab.prevListIndex ?? 0
  tab.itemDirection = action.listIndex > prev ? 1 : action.listIndex < prev ? -1 : 1
  tab.prevListIndex = action.listIndex
}
```

`PanelSlot` reads direction via `useNavigation().getItemDirection()`. No mutable refs cross component boundaries.

## Easing and timing

```ts
const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1]
const DURATION = 0.6  // seconds
const ITEM_GAP = 16   // pixels between panels during item transitions
```

- **Tab transitions**: Native smooth scroll (browser-controlled timing)
- **Item transitions**: CSS `@keyframes` with `0.6s cubic-bezier(0.32, 0.72, 0, 1)`
- **Panel exit**: CSS transition `width 0.6s + opacity 0.36s`

## Adding a new tab

1. Add the tab ID to `TabId` union in `src/types/navigation.ts`
2. Add default state in `createDefaultNavigationState()`
3. Add URL parsing in `NavigationProvider.tsx` (`buildUrl` + URL→state effect)
4. Add tab key to `TAB_SLOTS` in `App.tsx` and a case in `renderTab()`
5. Create a `*Tab.tsx` component following the `EmailTab` pattern
6. Create a `*ListV iew.tsx` using the generic `ListView` with a field schema
7. Add a sidebar nav item in `AppSidebar.tsx`
