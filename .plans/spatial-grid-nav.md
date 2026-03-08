# Spatial Canvas Panel Navigation

## Problem

The inbox has three independent views (Emails, Tasks, Sessions), each with horizontally-arranged panels (list → detail → session). The existing PanelStack used a flat column model that didn't distinguish between tab-level and panel-level navigation, leading to:

- Tab switches didn't feel spatial — they were abrupt DOM swaps
- Panel state was lost when switching tabs (e.g., selected email lost when switching to Tasks and back)
- Mobile layout was an afterthought — no full-screen overlays

## Mental Model

A 2D spatial canvas: vertical axis for tabs, horizontal axis for panels within a tab.

```
          ← panels →
          List  Detail  Session
    ↑  ┌──────┬───────┬─────────┐
       │ Emails list  │ thread  │  session  │  (inbox row)
  tabs │──────┼───────┼─────────┤
       │ Tasks list   │ detail  │  session  │  (tasks row)
    ↓  │──────┼───────┼─────────┤
       │ Sessions list│ view    │           │  (sessions row)
       └──────┴───────┴─────────┘
```

The viewport clips to one row at a time. Switching tabs slides the entire canvas vertically. Within a row, panels slide in/out horizontally.

## Architecture

### New files

**`src/hooks/use-spatial-nav.tsx`** — Context provider:
- `activeTab` — derived from `location.pathname` (`"inbox" | "tasks" | "sessions"`)
- `tabIndex` — numeric index into `TAB_ORDER`
- `persistedState` — ref (mutable, stable) holding `TabState` per tab
- `navigateToTab(tab)` — builds URL from persisted state and navigates
- `tabStateFromPathname(pathname, tab)` — pure function, exported, parses URL into `{ selectedId, sessionOpen, sessionId }`
- `buildUrl(tab, state)` — inverse of above

```
TabState = { selectedId?, sessionOpen?, sessionId? }
PersistedState = Record<"inbox"|"tasks"|"sessions", TabState>
```

**`src/components/layout/PanelStack.tsx`** — Replaces old column-based PanelStack:
- `usePanelState(tab)` — for active tab reads from URL (fresh); for inactive tabs reads from `persistedState` (persisted)
- `MobileOverlayPanel` — pure render-or-null, absolute positioned overlay
- `HorizontalPanel` — Framer Motion `motion.div`, slides in from left on mount, out on unmount
- `TabPane` — renders list + detail + session panels; separate mobile/desktop paths
- `PanelStack` — vertical slider, imperative DOM positioning

### Modified files

**`src/App.tsx`** — Wrap `AuthenticatedApp` in `<SpatialNavProvider>`, collapse individual routes to `<Route path="/*" element={<PanelStack />} />`

**`src/components/layout/AppSidebar.tsx`** — Replace `navigate(item.path)` with `navigateToTab(item.tab)` so sidebar uses spatial nav state restoration

## Vertical Tab Slider

**Why imperative DOM**: Framer Motion's declarative `animate` prop uses stale React state — when tabIndex changes and the sidebar closes simultaneously, the sidebar close animation changes the viewport height. Framer Motion captures the stale height in the animation target (`-2 * 650px` instead of `-2 * 745px`). The animation completes at the wrong position and the resize doesn't re-animate.

**Solution**: Two `useEffect` hooks on the slider `<div ref={sliderRef}>`:

1. **Tab switch effect** `[tabIndex]` — reads `viewport.clientHeight` at effect time (always fresh), animates if `isTabSwitch && hasAnimated`. Sets `tabIndexRef.current = tabIndex` so the ResizeObserver can read it without a stale closure.

2. **ResizeObserver effect** `[]` — mounts once for the component lifetime. Uses `tabIndexRef.current` (always current). Always snaps with `transition: "none"`. No dependency on `tabIndex` → observer never recreates.

```ts
// Effect 1: tab switch
useEffect(() => {
  const h = viewport.clientHeight
  const isTabSwitch = prevTabIndexRef.current !== tabIndex
  slider.style.transition = isTabSwitch && hasAnimated.current
    ? `transform 500ms ${EASE_CSS}`
    : "none"
  slider.style.transform = `translateY(${-tabIndex * h}px)`
  // also set height + pane heights
  tabIndexRef.current = tabIndex
  prevTabIndexRef.current = tabIndex
}, [tabIndex])

// Effect 2: resize snap
useEffect(() => {
  const ro = new ResizeObserver(() => {
    slider.style.transition = "none"
    slider.style.transform = `translateY(${-tabIndexRef.current * h}px)`
    // also set height + pane heights
  })
  ro.observe(viewport)
  return () => ro.disconnect()
}, [])  // ← empty deps, lives for component lifetime
```

**`overflow-clip`** on viewport and pane wrappers: prevents programmatic `scrollTop`/`scrollLeft` bleed between panes (which `overflow: hidden` doesn't prevent).

**`hasAnimated` ref**: starts false, set to true via `requestAnimationFrame` after first measurement. Prevents animation on initial load / deep link — the first render snaps into position.

## Horizontal Panels (Desktop)

Framer Motion `AnimatePresence mode="sync"` wraps each panel. Panel mounts → slides in from `x: -100%`. Panel unmounts → slides out to `x: -100%`. Key is the item ID so navigating between items remounts the panel with a fresh animation.

Session panel uses `key="session"` (stable) with `initial={false}` when it's an item switch (vs user opening it), preventing a spurious slide-in when switching items while session panel is already open.

## Mobile Overlays

Mobile uses `position: absolute; inset: 0` overlays instead of Framer Motion horizontal panels. Framer Motion conflicted with the absolute positioning (computed wrong x values like `x: -94px` instead of `0`).

`MobileOverlayPanel` is a pure render-or-null component. The `key` prop on each overlay changes when `selectedId` changes, forcing a React remount. No explicit enter animation needed — the overlay simply appears. The `visible` prop gate (`if (!visible) return null`) ensures unmounted overlays don't affect layout.

Z-index layering: list `undefined` (flow), detail overlay `10`, session overlay `20`.

## Panel Persistence

On every `location.pathname` change, `use-spatial-nav.tsx` syncs the active tab's parsed state into `persistedRef.current[activeTab]`. The ref is mutable and stable (doesn't cause re-renders).

`navigateToTab(tab)` reads `persistedRef.current[tab]` and builds the URL — restoring whatever was open in that tab.

## URL Schema

```
/inbox                              → inbox, no selection
/inbox/:threadId                    → inbox, thread selected
/inbox/:threadId/session/new        → inbox, thread + new session open
/inbox/:threadId/session/:sessionId → inbox, thread + existing session open
/tasks                              → tasks, no selection
/tasks/:taskId                      → tasks, task selected
/tasks/:taskId/session/...          → tasks, task + session
/sessions                           → sessions, no selection
/sessions/:sessionId                → sessions, session selected
```

## Key Bugs Fixed

| Bug | Root cause | Fix |
|-----|-----------|-----|
| Vertical slide stops at wrong offset on mobile | Framer Motion captured stale `viewportHeight` state during sidebar close animation | Imperative DOM, read `clientHeight` fresh at effect time |
| `overflow: hidden` didn't prevent list bleed | `scrollTop` still programmatically settable | `overflow: clip` |
| Deep link flash (always showed inbox first) | `viewportHeight=0` on first render → target was `0` regardless of tabIndex | `hasAnimated` ref, skip animation until after first `rAF` |
| Mobile overlay animation wrong x position | Framer Motion layout measurement conflicted with `position: absolute` | Pure CSS / render-or-null, no Framer Motion on mobile overlays |
| Mobile z-index: list covered overlay | List had `zIndex: 3`, overlay had `zIndex: 2` | Remove z-index from list on mobile, overlays use `10` / `20` |
| Tab switch animation killed by ResizeObserver | Two effects on `[tabIndex]` ran sequentially; second overwrote first's transition with `"none"` | Separate concerns: effect 1 handles tab switches, effect 2 (empty deps) handles resize |

## Easing

All animations use `cubic-bezier(0.32, 0.72, 0, 1)` at `500ms`. Defined once as `EASE_CSS` (string for CSS `transition`) and `EASE` (array for Framer Motion `ease`).
