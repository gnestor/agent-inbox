# Spatial Grid Navigation

The inbox uses a 2D spatial canvas for navigation. The vertical axis represents the three top-level tabs (Emails, Tasks, Sessions). The horizontal axis represents panels within each tab (list → detail → session). The viewport clips to one cell at a time — switching tabs slides the canvas vertically, and selecting an item slides the detail panel in horizontally.

```
          ← panels (horizontal) →
          List       Detail      Session
    ↑  ┌──────────┬───────────┬──────────┐
       │ Email    │ Thread    │ New      │  /inbox  /inbox/:id  /inbox/:id/session/…
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
/inbox                              → email list, nothing selected
/inbox/:threadId                    → email list + thread detail
/inbox/:threadId/session/new        → + new session panel
/inbox/:threadId/session/:sessionId → + existing session panel

/tasks                              → task list, nothing selected
/tasks/:taskId                      → task list + task detail
/tasks/:taskId/session/…            → + session panel

/sessions                           → session list, nothing selected
/sessions/:sessionId                → session list + session view
```

The `inbox` segment doubles as both the route prefix and the tab identifier. `tabFromPathname` maps `/inbox*` → `"inbox"`, `/tasks*` → `"tasks"`, `/sessions*` → `"sessions"`.

## State management

### Active tab state — URL

The URL is the only source of truth for what the active tab is currently showing. `tabStateFromPathname(pathname, tab)` is a pure function that parses it:

```ts
tabStateFromPathname("/inbox/abc123/session/new", "inbox")
// → { selectedId: "abc123", sessionOpen: true, sessionId: undefined }
```

### Inactive tab state — ref + localStorage

When the user switches tabs, their state in the previous tab needs to survive. `persistedRef` (a `useRef`, never causes re-renders) holds a `TabState` per tab:

```ts
type PersistedState = Record<TabId, TabState>
persistedRef.current = { inbox: { selectedId: "abc" }, tasks: {}, sessions: {} }
```

On every `location.pathname` change, the active tab's state is synced into `persistedRef.current[activeTab]`. When navigating to a tab, `navigateToTab(tab)` calls `buildUrl(tab, persistedRef.current[tab])` to reconstruct the URL with the persisted state.

**localStorage persistence**: After every URL change, `saveNavState` writes the current pathname, all tab states, and the full `itemSessionRef` map to `localStorage` under the key `"spatial-nav-state"`. On mount, if the user lands at the default `/inbox` route, `SpatialNavProvider` reads the saved state and calls `navigate(saved.pathname, { replace: true })` to restore the last-visited URL. This survives page refreshes.

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

### Item switching — Framer Motion `AnimatePresence` (vertical, inside `ItemSlider`)

Within a tab, selecting a different item animates the detail (and session) panel vertically. `ItemSlider` wraps the detail+session group in `AnimatePresence mode="popLayout"`. Direction is derived from the item's list index — if the new item is below the previous one in the list (higher index), direction is +1 (enter from below). The list components call `onSelectedIndexChange` to update `directionRef` synchronously during the list's render, before `ItemSlider` reads it.

```ts
const itemVariants = {
  enter: (d) => ({ y: `${d * 100}%` }),   // +1 = from below, -1 = from above
  center: { y: 0 },
  exit:  (d) => ({ y: `${-d * 100}%` }),  // opposite direction
}
```

The detail and session panels animate together as a unit (they share one `motion.div` with `key={selectedId}`), so switching items slides both panels simultaneously.

### Session panel open/close — no separate animation

The session panel lives inside `ItemSlider`'s `renderContent`. Opening/closing it changes `sessionOpen` which changes the content of the existing `motion.div`, not a separate enter/exit — the item-slide animation handles it if the item also changes. If only the session state changes (same item), the session panel appears/disappears without animation at the desktop level (the content change is immediate inside the stable item motion.div). This avoids double-animation when switching items while a session is open.

## Mobile animations

Mobile uses Framer Motion `motion.div` overlays with spring physics and drag gestures.

### Tab switching

Same `AnimatePresence` + `tabVariants` as desktop, but the `motion.div` is also draggable (`drag="y"`). The drag is started from the header via `HeaderNavContext.startTabDrag` — the header initiates the drag but the `motion.div` in `PanelStack` actually tracks it (`dragListener={false}` + `dragControls`). This prevents accidental tab swipes when scrolling content.

**Direction semantics** (mirroring natural swipe-to-scroll behavior):
- Drag panel **DOWN** → navigate to the tab **above** (lower index): triggered at >35% of screen height _or_ velocity >400px/s. There is plenty of screen space to drag, so distance threshold applies.
- Flick panel **UP** → navigate to the tab **below** (higher index): velocity only (>400px/s). Dragging upward takes the panel off-screen quickly, so only fast flicks are practical.

These semantics match the `tabVariants` animation: higher-index tab enters from below, lower-index enters from above.

### Detail overlay (`MobileOverlayPanel`)

`MobileOverlayPanelInner` is a `motion.div` with `position: absolute; inset: 0` that slides in from the right on mount (`initial={{ x: "100%" }}`). Spring transition (`damping: 30, stiffness: 300`).

Drag gestures are direction-locked and controlled from the header (same pattern as tab drag):
- **Swipe right** (dismiss): >30% width or >400px/s → `setPhase("dismissing")` → animate to `x: "100%"` → on animation complete, call `onDismiss()` which navigates back. The two-step (phase → animation → navigate) prevents the immediate unmount that would cut the exit animation short.
- **Swipe left** (forward): >30% width or >400px/s → `onForward()` (navigate to session). Only available on detail overlay, not session overlay.
- **Swipe vertical** (tab switch): If `|oy| > |ox|`, treat as a tab swipe gesture instead of dismiss/forward. Same direction semantics as the base panel: drag DOWN → prev tab, flick UP → next tab.

`skipEntrance` prop: when the detail was already open before the tab switch (e.g., switching back to a tab that had an item selected), the overlay should snap into place rather than slide in. `TabPane` computes this by comparing `selectedId` to `initialDetailId.current` (captured at mount).

### Session overlay

Same as detail overlay but at `zIndex: 20` (above detail at `zIndex: 10`). Only has `onDismiss`, not `onForward`.

### `HeaderNavContext`

Passed down through the component tree so header components (back button, title, etc.) can initiate drag gestures on the draggable elements they're visually part of. All three callbacks are optional — components only receive what's available in their layer.

| Callback | Provided by | Used when |
|----------|-------------|-----------|
| `onTabSwipe` | `PanelStack` (top-level) | Fires after gesture resolves to a tab change |
| `startTabDrag` | `PanelStack` (top-level) | Header on the **base list panel** — starts drag on the tab pane `motion.div` |
| `startOverlayDrag` | `MobileOverlayPanelInner` | Header **inside an overlay** — starts drag on that overlay's `motion.div` |

`PanelHeader` detects direction after `AXIS_THRESHOLD` (8px) of movement and routes accordingly:
1. If `startOverlayDrag` is set → hand off both axes (overlay handles direction-lock)
2. Else if vertical and `startTabDrag` is set → hand off to tab pane drag
3. Else if vertical and `onTabSwipe` → manual discrete tracking (fallback)

```ts
// Example: header inside a detail overlay
const { startOverlayDrag } = useHeaderNav()  // provided by MobileOverlayPanelInner
// PanelHeader calls controls.start(nativeEvent) after detecting 8px of movement
```

## Easing

All animations use `cubic-bezier(0.32, 0.72, 0, 1)` at 500ms duration. Defined once:

```ts
const EASE: [number, number, number, number] = [0.32, 0.72, 0, 1]
const DURATION = 0.5
```

Spring transitions for mobile overlays use `damping: 30, stiffness: 300` (no duration — spring physics).

## List data caching (`list-cache.ts`)

`useEmails`, `useTasks`, and `useSessions` share a thin in-memory cache (`src/lib/list-cache.ts`) keyed by a string (e.g. `"emails:in:inbox is:important"`, `"tasks:{\"status\":\"In Progress\"}"`). On hook mount, if there's a cache hit the hook initializes state from the cache and skips the loading skeleton. New data from the server replaces the cache entry and updates state in-place.

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
