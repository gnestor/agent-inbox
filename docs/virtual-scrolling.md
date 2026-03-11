# Virtual Scrolling

All list views and the session transcript use `@tanstack/react-virtual` for virtualized rendering.

## Virtualized Components

| Component | Hook | `estimateSize` | Notes |
|---|---|---|---|
| `EmailList` | `useVirtualizer` | 88px | Fixed-height items |
| `TaskList` | `useVirtualizer` | 66px | Fixed-height items |
| `SessionList` | `useVirtualizer` | 76px | Fixed-height items |
| `SessionTranscript` | `useVirtualizerSafe` | 44px | Variable height, uses `measureElement` |

`EmailThread` is **not** virtualized — threads typically have <20 messages, and each contains an auto-resizing iframe.

## Pattern

All virtualized lists follow the same structure:

```tsx
const scrollRef = useRef<HTMLDivElement>(null)

const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => HEIGHT,
  overscan: 5,
  useAnimationFrameWithResizeObserver: true,
})

return (
  <div ref={scrollRef} className="flex-1 overflow-y-auto">
    <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((virtualRow) => (
        <div
          key={virtualRow.key}
          data-index={virtualRow.index}
          ref={virtualizer.measureElement}
          style={{
            position: "absolute",
            top: 0, left: 0, width: "100%",
            transform: `translateY(${virtualRow.start}px)`,
          }}
        >
          <Item item={items[virtualRow.index]} />
        </div>
      ))}
    </div>
  </div>
)
```

`useAnimationFrameWithResizeObserver: true` defers ResizeObserver callbacks to RAF so accordion-open animations (which fire ResizeObserver ~60×/sec) don't trigger synchronous React state updates during the commit phase.

## SessionTranscript: useVirtualizerSafe

`SessionTranscript` uses `useVirtualizerSafe` (`src/hooks/use-virtualizer-safe.ts`) instead of `useVirtualizer`. This is a drop-in replacement that prevents "Maximum update depth exceeded" in React 19.

**Root cause:** When `ref={virtualizer.measureElement}` fires during `commitAttachRef`, TanStack Virtual calls `resizeItem → notify(false) → onChange(instance, false)`. The default `useVirtualizer` dispatches a plain `useState` update synchronously. React 19's `flushSpawnedWork` processes this within `commitRoot`, triggering another synchronous commit. If any items measure differently from the estimate, new items enter the virtual window, attach more refs, dispatch more updates — cascading until the 50-nested-update limit throws.

**Fix:** `useVirtualizerSafe` wraps `onChange` with `sync=false` (item resize) in `React.startTransition`. Transition updates use `TransitionLane`, which `flushSyncWorkAcrossRoots_impl` does NOT process synchronously, so the cascade never starts. Scroll updates (`sync=true`) remain immediate for smooth UX.

`TranscriptAccordionEntry` also uses a local `useState` toggle instead of base-ui's `Accordion`/`AccordionItem`, which registers items via `setState` in `useLayoutEffect` — a second source of the same cascade when many messages mount simultaneously.

## Infinite Scroll

`useVirtualInfiniteScroll` (`src/hooks/use-infinite-scroll.ts`) replaces the old `IntersectionObserver`-based sentinel approach. It watches `virtualizer.range.endIndex` and triggers `loadMore` when the user is within 12 items of the end.

```ts
useVirtualInfiniteScroll(virtualizer, loadMore, hasMore, loading || loadingMore)
```

This is more responsive than the sentinel approach because it triggers proactively based on scroll position rather than waiting for a DOM element to intersect.
