# Spatial Grid Navigation

The inbox uses a 2D spatial canvas for navigation. The vertical axis represents the three top-level tabs (Emails, Tasks, Sessions). The horizontal axis represents panels within each tab (list → detail → session). The viewport clips to one cell at a time — switching tabs slides the canvas vertically, and selecting an item slides the detail panel in horizontally.

```
          ← panels (horizontal) →
          List       Detail      Session
    ↑  ┌──────────┬───────────┬──────────┐
       │ Email    │ Thread    │ New      │  /emails  /emails/:id  /emails/:id/session/…
  tabs │ list     │ view      │ session  │
  (vert│──────────┼───────────┼──────────┤
  ical)│ Task     │ Task      │ New      │  /tasks  /tasks/:id  /tasks/:id/session/…
       │ list     │ detail    │ session  │
    ↓  │──────────┼───────────┼──────────┤
       │ Session  │ Session   │          │  /sessions  /sessions/:id
       │ list     │ view      │          │
       └──────────┴───────────┴──────────┘
```

## Key files

| File | Role |
|------|------|
| [`src/hooks/use-spatial-nav.tsx`](../src/hooks/use-spatial-nav.tsx) | Context: derives tab from URL, persists tab state, restores from localStorage |
| [`src/hooks/use-header-nav.ts`](../src/hooks/use-header-nav.ts) | Context: passes swipe/drag callbacks from PanelStack down to header components |
| [`src/lib/list-cache.ts`](../src/lib/list-cache.ts) | Shared in-memory cache for list data (emails, tasks, sessions) |
| [`src/components/layout/PanelStack.tsx`](../src/components/layout/PanelStack.tsx) | Renders animated tab container + per-tab panels |
| [`src/components/layout/AppSidebar.tsx`](../src/components/layout/AppSidebar.tsx) | Uses `navigateToTab` instead of raw `navigate` for tab switching |

## URL schema

The URL is the canonical source of truth for what's visible.

```
/emails                              → email list, nothing selected
/emails/:threadId                    → email list + thread detail
/emails/:threadId/session/new        → + new session panel
/emails/:threadId/session/:sessionId → + existing session panel

/tasks                              → task list, nothing selected
/tasks/:taskId                      → task list + task detail
/tasks/:taskId/session/…            → + session panel

/sessions                           → session list, nothing selected
/sessions/:sessionId                → session list + session view
```

`tabFromPathname` maps `/emails*` → `"emails"`, `/tasks*` → `"tasks"`, `/sessions*` → `"sessions"`.

## State management

### Active tab state — URL

The URL is the only source of truth for what the active tab is currently showing. `tabStateFromPathname(pathname, tab)` is a pure function that parses it:

```ts
tabStateFromPathname("/emails/abc123/session/new", "emails")
// → { selectedId: "abc123", sessionOpen: true, sessionId: undefined }
```

### Inactive tab state — ref + localStorage

When the user switches tabs, their state in the previous tab needs to survive. `persistedRef` (a `useRef`, never causes re-renders) holds a `TabState` per tab:

```ts
type PersistedState = Record<TabId, TabState>
persistedRef.current = { emails: { selectedId: "abc" }, tasks: {}, sessions: {} }
```

On every `location.pathname` change, the active tab's state is synced into `persistedRef.current[activeTab]`. When navigating to a tab, `navigateToTab(tab)` calls `buildUrl(tab, persistedRef.current[tab])` to reconstruct the URL with the persisted state.

**localStorage persistence**: After every URL change, `saveNavState` writes the current pathname, all tab states, and the full `itemSessionRef` map to `localStorage` under the key `"spatial-nav-state"`. On mount, if the user lands at the default `/emails` route, `SpatialNavProvider` reads the saved state and calls `navigate(saved.pathname, { replace: true })` to restore the last-visited URL. This survives page refreshes.

```ts
interface SavedNavState {
  pathname: string
  tabs: PersistedState
  itemSessions: Array<[string, { sessionOpen: boolean; sessionId?: string }]>
}
```

### Per-item session state — Map ref

When a user opens a session panel for an email/task and then navigates to a different item in the same list, the session panel's open/closed state and sessionId need to be remembered per item. `itemSessionRef` is a `Map<"tab:itemId", { sessionOpen, sessionId }>` that:

1. **Saves** outgoing item's session state when `selectedId` changes
2. **Updates** the map when the session is explicitly opened/closed (URL changes for same item)
3. **Restores** session state when navigating back to an item that had a session open, replacing the URL silently via `navigate(..., { replace: true })`

### `usePanelState(tab)` hook

Called inside each `TabPane`. For the active tab it calls `tabStateFromPathname` directly (fresh from URL, avoids stale ref during render). For inactive tabs it reads `persistedRef.current[tab]`.

```ts
const state = tab === activeTab
  ? tabStateFromPathname(location.pathname, tab)
  : persistedState[tab]
```

## Desktop animations

### Tab switching — Framer Motion `AnimatePresence` (vertical)

`PanelStack` renders only the active tab's `TabPane` inside `AnimatePresence`. On tab change the old pane exits and the new pane enters simultaneously (`initial={false}` to skip the very first mount animation). Direction is tracked in `directionRef` during render (not in state) and passed as the `custom` prop:

```ts
// tabVariants (with GAP=16 to show a sliver of separation between panes)
enter: (d) => ({ y: d >= 0 ? `calc(100% + 16px)` : `calc(-100% - 16px)` })
center: { y: 0 }
exit:  (d) => ({ y: d >= 0 ? `calc(-100% - 16px)` : `calc(100% + 16px)` })
```

Going Emails→Tasks (direction +1): Tasks enters from bottom, Emails exits to top.
Going Tasks→Emails (direction -1): Emails enters from top, Tasks exits to bottom.

Animation: `cubic-bezier(0.32, 0.72, 0, 1)` at 600ms duration.

### Item switching — Framer Motion `AnimatePresence` (vertical, inside `ItemSlider`)

Within a tab, selecting a different item animates the detail (and session) panel vertically. `ItemSlider` wraps the detail+session group in `AnimatePresence mode="popLayout"` using a grid single-cell layout (both entering and exiting items occupy cell (1,1) so `scrollWidth` never collapses mid-transition). Direction is derived from the item's list index — if the new item is below the previous one in the list (higher index), direction is +1 (enter from below). The list components call `onSelectedIndexChange` to update `directionRef` synchronously during the list's render, before `ItemSlider` reads it.

```ts
const itemVariants = {
  enter: (d) => ({ y: d >= 0 ? `calc(100% + 16px)` : `calc(-100% - 16px)` }),
  center: { y: 0 },
  exit:  (d) => ({ y: d >= 0 ? `calc(-100% - 16px)` : `calc(100% + 16px)` }),
}
```

The detail and session panels animate together as a unit (they share one `motion.div` with `key={selectedId}`), so switching items slides both panels simultaneously.

### Panel group horizontal scroll (desktop)

The `TabPane` scroll container (`overflow-x-auto`) scrolls horizontally when detail/session panels open or close. `getScrollTarget` is a pure function that computes where to scroll based on what changed:

| Change | Scroll target |
|--------|--------------|
| Detail added | `scrollWidth - clientWidth` (immediate) |
| Detail removed | `0` (immediate) |
| Session added | `scrollWidth - clientWidth` (deferred one frame for layout) |
| Session removed | `scrollLeft - 632` clamped to 0 (immediate) |

Scroll behavior depends on **when** the effect runs:

- **Tab mount (first run)**: `isFirstScroll.current` is `true`. Uses instant `el.scrollLeft = target` so the scroll position is already correct before the tab enter animation plays. The flag is cleared before the early-return guard so a tab mounting with no selected item also resets it.
- **Subsequent runs (user interaction)**: Uses `smoothScrollTo()` — a `requestAnimationFrame` loop with cubic-ease-out over 600ms.

```ts
const isFirstScroll = useRef(true)
// Cleared before action check — ensures the flag resets even if action is null
const first = isFirstScroll.current
isFirstScroll.current = false
if (!action) return
// ...
if (first) { el.scrollLeft = action.target } else { smoothScrollTo(el, action.target, rafRef) }
```

Horizontal trackpad swipes inside panels are intercepted via `wheel` event handlers on the list panel and item slider, redirected to the outer scroll container so they scroll the panel group rather than inner `overflow-y-auto` elements.

## Mobile animations

Mobile uses Framer Motion `motion.div` overlays with spring physics and drag gestures.

### Tab switching

Same `AnimatePresence` + `tabVariants` as desktop. The `AnimatePresence` is wrapped in a **persistent** `<motion.div style={{ y: tabY }}>` that carries the drag-y offset. This persistent wrapper avoids the `dragControls` binding issues that occur when `AnimatePresence` mounts both exiting and entering elements simultaneously.

**Direction semantics** (mirroring natural swipe-to-scroll behavior):
- Drag panel **DOWN** → navigate to the tab **above** (lower index): triggered at >35% of screen height _or_ velocity >400px/s.
- Flick panel **UP** → navigate to the tab **below** (higher index): velocity only (>400px/s) or offset >5% height.

**Manual pointer tracking** (`startTabDrag`): The header initiates a drag by calling `startTabDrag(nativeEvent)`. This registers `pointermove`/`pointerup` listeners on `window` and updates `tabY` motion value directly (no Framer Motion drag system). On `pointerup`, `classifyTabDrag` decides: navigate (instant `tabY.set(0)` then `navigateToTab`) or snap back (`animate(tabY, 0, SNAP_SPRING)`).

### Detail overlay (`MobileOverlayPanel`)

`MobileOverlayPanelInner` uses `useMotionValue` for `x` and `y` instead of Framer Motion's `animate` prop. This gives explicit control over snap-back after sub-threshold drags, which `dragMomentum={false}` + `animate={{ x: 0 }}` alone cannot achieve (Framer Motion's drag offset accumulates independently of the `animate` target).

On mount: `x` starts at `window.innerWidth` (off-screen right) and slides in via `animate(x, 0, SLIDE_SPRING)`. If `skipEntrance` is true, `x` starts at `0` immediately (no slide-in animation — for tab switches where the overlay was already open).

Drag gestures are direction-locked (`dragDirectionLock`) and controlled from the header (`dragListener={false}` + `dragControls`):
- **Swipe right** (dismiss): >30% width or >400px/s → `animate(x, window.innerWidth, SLIDE_SPRING).then(() => onDismiss())`. The two-step (animate → callback) prevents the immediate unmount that would cut the exit animation short.
- **Swipe left** (forward): >30% width or >400px/s → `animate(x, 0, SNAP_SPRING)` then `onForward()`. Only on detail overlay, not session overlay.
- **Swipe vertical** (tab switch): If `|oy| > |ox|`, treat as a tab swipe. Same direction semantics as the base panel: drag DOWN → prev tab, flick UP → next tab.
- **Below all thresholds** (snap-back): `animate(x, 0, SNAP_SPRING)` + `animate(y, 0, SNAP_SPRING)`.

`skipEntrance` prop: when the detail was already open before the tab switch (e.g., switching back to a tab that had an item selected), the overlay should snap into place rather than slide in. `TabPane` computes this by comparing `selectedId` to `initialDetailId.current` (captured at mount).

### Session overlay

Same as detail overlay but at `zIndex: 20` (above detail at `zIndex: 10`). Only has `onDismiss`, not `onForward`.

### Spring constants

```ts
// Snappy — for snap-back after sub-threshold drag
const SNAP_SPRING = { type: "spring", stiffness: 400, damping: 35 }
// Smooth — for entrance, dismiss, and tab pane exit animations
const SLIDE_SPRING = { type: "spring", damping: 30, stiffness: 300 }
```

### `HeaderNavContext`

Passed down through the component tree so header components (back button, title, etc.) can initiate drag gestures on the draggable elements they're visually part of. All three callbacks are optional — components only receive what's available in their layer.

| Callback | Provided by | Used when |
|----------|-------------|-----------|
| `onTabSwipe` | `PanelStack` (top-level) | Fires after gesture resolves to a tab change |
| `startTabDrag` | `PanelStack` (top-level) | Header on the **base list panel** — starts manual pointer tracking for tab-y drag |
| `startOverlayDrag` | `MobileOverlayPanelInner` | Header **inside an overlay** — starts drag on that overlay's `motion.div` via `dragControls` |

`PanelHeader` detects direction after `AXIS_THRESHOLD` (8px) of movement and routes accordingly:
1. If `startOverlayDrag` is set → hand off both axes (overlay handles direction-lock)
2. Else if vertical and `startTabDrag` is set → hand off to tab pane manual pointer tracking
3. Else if vertical and `onTabSwipe` → manual discrete tracking (fallback)

```ts
// Example: header inside a detail overlay
const { startOverlayDrag } = useHeaderNav()  // provided by MobileOverlayPanelInner
// PanelHeader calls startOverlayDrag(nativeEvent) after detecting 8px of movement
```

## Easing

All non-spring animations use `cubic-bezier(0.32, 0.72, 0, 1)` at 600ms duration:

```ts
const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1]
const DURATION = 0.6
```

Mobile overlay entrance/dismiss use spring transitions (no fixed duration — spring physics). Snap-back uses a stiffer spring for a snappier feel.

## List data caching (`list-cache.ts`)

`useEmails`, `useTasks`, and `useSessions` share a thin in-memory cache (`src/lib/list-cache.ts`) keyed by a string (e.g. `"emails:in:inbox is:important"`, `"tasks:{\"status\":\"In Progress\"}""`). On hook mount, if there's a cache hit the hook initializes state from the cache and skips the loading skeleton. New data from the server replaces the cache entry and updates state in-place.

This keeps list views instant when switching tabs or navigating back — the list rerenders immediately with cached data while a background refresh happens (if needed).

## `enabled` prop on list components

All three list components (`EmailList`, `TaskList`, `SessionList`) accept an `enabled` prop. When `false`, they skip data fetching. `TabPane` passes `enabled={hasBeenActive.current}` — a ref that becomes `true` the first time the pane is the active tab and stays true forever. This means inactive tabs don't fetch on initial load, but once the user visits a tab its data loads and stays loaded even when the tab is not active.

## Adding a new tab

1. Add the tab ID to `TAB_ORDER` in `use-spatial-nav.tsx`
2. Add a route prefix case to `tabFromPathname`
3. Add URL parsing logic to `tabStateFromPathname` if the tab has sub-routes
4. Add a list component import and branch in `TabPane`'s `listPanel`
5. Add the detail component to `DetailContent`
6. Add a sidebar nav item in `AppSidebar.tsx`
