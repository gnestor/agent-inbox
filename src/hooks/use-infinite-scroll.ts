import { useEffect } from "react"
import type { Virtualizer } from "@tanstack/react-virtual"

/**
 * Triggers `loadMore` when the virtualizer's visible range approaches the end of the list.
 * `overscan` is how many items from the end to trigger (default 5).
 */
export function useVirtualInfiniteScroll(
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  loadMore: () => void,
  hasMore: boolean,
  loading: boolean,
  overscan = 12,
) {
  const range = virtualizer.range

  useEffect(() => {
    if (!hasMore || loading || !range) return
    if (range.endIndex >= virtualizer.options.count - overscan) {
      loadMore()
    }
  }, [range?.endIndex, virtualizer.options.count, hasMore, loading, loadMore, overscan])
}
