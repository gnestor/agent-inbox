import { useRef, useEffect } from "react"

type SwipeDirection = "left" | "right" | "up" | "down"

const MIN_DISTANCE = 60
const MAX_CROSS_RATIO = 0.75 // cross-axis must be less than this fraction of main axis

export function useSwipe(onSwipe: (direction: SwipeDirection) => void, enabled = true) {
  const ref = useRef<HTMLDivElement>(null)
  const stableCallback = useRef(onSwipe)
  stableCallback.current = onSwipe

  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return

    let startX = 0
    let startY = 0
    let startTime = 0

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      startX = touch.clientX
      startY = touch.clientY
      startTime = Date.now()
    }

    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0]
      if (!touch) return
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      const elapsed = Date.now() - startTime

      // Ignore slow drags (>600ms) — likely scrolling
      if (elapsed > 600) return

      if (absDx > absDy) {
        // Horizontal swipe
        if (absDx < MIN_DISTANCE) return
        if (absDy > absDx * MAX_CROSS_RATIO) return
        stableCallback.current(dx > 0 ? "right" : "left")
      } else {
        // Vertical swipe
        if (absDy < MIN_DISTANCE) return
        if (absDx > absDy * MAX_CROSS_RATIO) return
        stableCallback.current(dy > 0 ? "down" : "up")
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchend", onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchend", onTouchEnd)
    }
  }, [enabled])

  return ref
}
