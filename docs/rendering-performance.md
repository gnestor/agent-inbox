# Rendering Performance

Patterns in place to minimize unnecessary React re-renders, especially across the 3 tab panes.

## Key-Scoped Preference Subscriptions

**File**: `src/hooks/use-preferences.ts`

The module-level listener registry uses `Map<string, Set<() => void>>` keyed by preference key, rather than a flat `Set`. When `setValue` is called, only the listeners registered for that specific key are notified.

```ts
function notifyListeners(key: string) {
  const set = listeners.get(key)
  if (set) for (const fn of set) fn()
}
```

Initial load calls `notifyAll()` which iterates all entries in the map.

**Impact**: Toggling `emails.showLabels` re-renders the 1–2 components subscribed to that key instead of every `usePreference` subscriber across all 3 tabs.

## Memoized ListItem

**File**: `src/components/shared/ListItem.tsx`

`ListItem` is wrapped with `React.memo` and a custom comparator that:
- Compares `title`, `subtitle`, `timestamp`, `isSelected` by value
- Compares `badges` structurally (length + per-element label/variant/className)
- **Skips `onClick`** — inline closures are recreated on each parent render, but the navigation target is stable as long as item identity (captured by `title`/`isSelected`) hasn't changed

```ts
export const ListItem = memo(ListItemInner, (prev, next) =>
  prev.title === next.title &&
  prev.subtitle === next.subtitle &&
  prev.timestamp === next.timestamp &&
  prev.isSelected === next.isSelected &&
  badgesEqual(prev.badges, next.badges)
)
```

**Impact**: With 50–100 virtualized items per tab, a preference toggle or parent re-render skips the DOM diff for every item whose visual state is unchanged.

## Stable `loadMore` Callback

**Files**: `src/hooks/use-emails.ts`, `src/hooks/use-tasks.ts`

The `loadingMore` guard uses a ref instead of being included in `useCallback` deps:

```ts
const loadingMoreRef = useRef(false)
const loadMore = useCallback(async () => {
  if (!nextPageToken.current || loadingMoreRef.current) return
  loadingMoreRef.current = true
  // ...
  loadingMoreRef.current = false
}, [query])  // loadingMore removed from deps
```

**Impact**: The `loadMore` function reference stays stable across load cycles. `useVirtualInfiniteScroll` depends on `loadMore` in its effect deps, so a changing reference was causing the effect to re-run (and re-check scroll position) after every page load.

## Deferred Tab Fetching

**File**: `src/components/layout/PanelStack.tsx`

`PanelStack` uses `AnimatePresence` with `key={activeTab}`, rendering only one `TabPane` at a time. When the user switches tabs, the old pane exits (animated) and the new one enters. Because the pane is freshly mounted, its data hook fires its initial fetch at that point rather than at app load.

```tsx
<AnimatePresence initial={false} custom={direction}>
  <motion.div key={activeTab} ...>
    <TabPane tab={activeTab} active={true} />
  </motion.div>
</AnimatePresence>
```

Previously, all 3 `TabPane` components were always mounted (scrolled off-screen), which triggered 3 parallel API fetches on load.

**Impact**: Initial page load makes 1 API call (inbox). Tasks and Sessions fetch only when first visited, then their cached state is restored from localStorage on subsequent tab switches.

### Interaction with list cache

When a tab is revisited, `useEmails` / `useTasks` / `useSessions` initialize from the localStorage list cache (stale data renders immediately), then the fresh fetch completes in the background. See [caching-architecture.md](./caching-architecture.md).

## Title Propagation via setState-During-Render

**Files**: `TabPane` in `src/components/layout/PanelStack.tsx`, all list components

Detail panel headers show the selected item's title before the detail fetch completes. The title is already known from the list. List components call the parent's state setter synchronously during their own render (not in an effect):

```ts
// TabPane:
const [selectedTitle, setSelectedTitle] = useState("")
// ...
<EmailList onSelectedTitleChange={setSelectedTitle} ... />

// Inside EmailList's render body (synchronous, no useEffect):
onSelectedTitleChange?.(threads[selectedIndex].subject)
```

React treats this as "update state during rendering" — it restarts the render pass with the new state before committing, so `selectedTitle` is current by the time `DetailContent` renders. React deduplicates when the value is unchanged, preventing loops.

Detail panels receive `title` as a prop and use it directly in the header. They do not manage their own title state or fall back to the fetched detail data.

**Why not a ref?** A ref set during the list's render would be read during `TabPane`'s render before the list renders (parent renders first). `useState` + the "update during render" pattern correctly sequences the update so it's visible in the same commit.
