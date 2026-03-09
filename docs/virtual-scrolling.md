# Virtual Scrolling

All list views and the session transcript use `@tanstack/react-virtual` for virtualized rendering.

## Virtualized Components

| Component | `estimateSize` | Notes |
|---|---|---|
| `EmailList` | 88px | Fixed-height items |
| `TaskList` | 66px | Fixed-height items |
| `SessionList` | 66px | Fixed-height items |
| `SessionTranscript` | 40px | Variable height, uses `measureElement` with ResizeObserver |

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

## Infinite Scroll

`useVirtualInfiniteScroll` (`src/hooks/use-infinite-scroll.ts`) replaces the old `IntersectionObserver`-based sentinel approach. It watches `virtualizer.range.endIndex` and triggers `loadMore` when the user is within 12 items of the end.

```ts
useVirtualInfiniteScroll(virtualizer, loadMore, hasMore, loading || loadingMore)
```

This is more responsive than the sentinel approach because it triggers proactively based on scroll position rather than waiting for a DOM element to intersect.
