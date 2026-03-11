/**
 * Drop-in replacement for useVirtualizer that prevents "Maximum update depth exceeded"
 * in React 19 when many items are measured simultaneously.
 *
 * Root cause: useVirtualizer's internal onChange calls a plain useState dispatch
 * synchronously when the measureElement ref fires (commitAttachRef → resizeItem →
 * notify(false) → onChange(instance, false)). In React 19, flushSpawnedWork processes
 * that dispatch immediately within commitRoot, triggering another synchronous commit,
 * which attaches more refs, which dispatch more updates… repeating until the
 * 50-nested-update limit throws.
 *
 * TanStack Virtual sync semantics (from the source):
 *   sync=false → item size change (resizeItem always calls notify(false)) — CASCADE PATH
 *   sync=true  → scroll offset change (_handleScroll calls notify(true)) — safe, immediate
 *
 * Fix: wrap the sync=false (resize) rerender in startTransition. Transition updates
 * use TransitionLane, which flushSyncWorkAcrossRoots_impl does NOT process synchronously,
 * so the cascade never starts. Scroll updates (sync=true) stay immediate for smooth UX.
 */
import {
  Virtualizer,
  observeElementRect,
  observeElementOffset,
  elementScroll,
  type VirtualizerOptions,
  type PartialKeys,
} from "@tanstack/react-virtual"
import * as React from "react"
import { useState, useEffect, useLayoutEffect } from "react"

export function useVirtualizerSafe<
  TScrollElement extends Element,
  TItemElement extends Element,
>(
  options: PartialKeys<
    VirtualizerOptions<TScrollElement, TItemElement>,
    "observeElementRect" | "observeElementOffset" | "scrollToFn"
  >,
): Virtualizer<TScrollElement, TItemElement> {
  const [, rerender] = useState({})

  const resolvedOptions: VirtualizerOptions<TScrollElement, TItemElement> = {
    observeElementRect: observeElementRect as never,
    observeElementOffset: observeElementOffset as never,
    scrollToFn: elementScroll as never,
    ...options,
    onChange: (instance, sync) => {
      if (!sync) {
        // sync=false: item size change (measureElement ref during commitAttachRef,
        // or ResizeObserver). This is the cascade path in React 19 — wrap in
        // startTransition so flushSpawnedWork doesn't process it synchronously.
        React.startTransition(() => rerender({}))
      } else {
        // sync=true: scroll offset change — must be immediate for smooth scrolling.
        rerender({})
      }
      options.onChange?.(instance, sync)
    },
  }

  const [instance] = useState(
    () => new Virtualizer<TScrollElement, TItemElement>(resolvedOptions),
  )
  instance.setOptions(resolvedOptions)

  useEffect(() => instance._didMount(), [])
  useLayoutEffect(() => instance._willUpdate())

  return instance
}
