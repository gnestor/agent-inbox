import { useEffect, useRef, type RefObject } from "react"

/**
 * Infinite-scroll driver that preloads rows BEFORE the user reaches the bottom.
 * Attach the returned `sentinelRef` to a zero-height element after the last row.
 *
 * Mirrors Studio's `useInfiniteScroll` (packages/studio/src/client/hooks): two
 * cooperating effects keep a buffer of rows loaded ahead of the viewport —
 *
 *  1. An IntersectionObserver against the VIEWPORT (no explicit root) whose root
 *     is expanded downward by `preloadPx`, so it fires while the sentinel is
 *     still that far below the viewport — never at the very bottom. Using the
 *     viewport (not the scroll container) is deliberate: `getBoundingClientRect`
 *     is viewport-relative and works whether the window or an inner overflow
 *     container scrolls, and avoids the rootMargin-vs-clipped-root quirks that
 *     make a container root fire late ("Loading more…" appearing at the bottom).
 *  2. An eager-fill effect that re-runs after each page lands and keeps fetching
 *     while the sentinel is within `preloadPx`, so the initial load builds the
 *     full buffer instead of one page at a time.
 */
const ROW_PX = 72
const DEFAULT_PRELOAD_ROWS = 50

export function useInfiniteScroll({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  itemCount,
  preloadPx = ROW_PX * DEFAULT_PRELOAD_ROWS,
}: {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => unknown
  itemCount: number
  preloadPx?: number
}): { sentinelRef: RefObject<HTMLDivElement | null> } {
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: `0px 0px ${preloadPx}px 0px` },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, preloadPx])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage || isFetchingNextPage) return
    const distanceBelowViewport = node.getBoundingClientRect().top - window.innerHeight
    if (distanceBelowViewport < preloadPx) fetchNextPage()
  }, [itemCount, hasNextPage, isFetchingNextPage, fetchNextPage, preloadPx])

  return { sentinelRef }
}
