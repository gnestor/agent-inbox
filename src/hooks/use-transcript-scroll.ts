import { useRef, useEffect } from "react"

interface UseTranscriptScrollOptions {
  /** Number of visible messages (used to detect when messages arrive) */
  messageCount: number
  sessionId?: string
}

/**
 * Manages transcript scroll behavior without JS virtualization.
 *
 * Messages render in normal document flow — no absolute positioning, no
 * estimated heights, no measurement dance. Offscreen messages use CSS
 * `content-visibility: auto` (set in SessionTranscript) for rendering
 * performance. This gives native-feeling scroll with zero layout jumps.
 */
export function useTranscriptScroll({
  messageCount,
  sessionId,
}: UseTranscriptScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const hasScrolledToBottom = useRef(false)

  // Reset when session changes
  useEffect(() => {
    hasScrolledToBottom.current = false
    shouldAutoScroll.current = true
  }, [sessionId])

  // Scroll to bottom once messages are available
  useEffect(() => {
    if (hasScrolledToBottom.current) return
    if (messageCount === 0) return
    const el = scrollRef.current
    if (!el) return

    hasScrolledToBottom.current = true
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [messageCount])

  // Auto-scroll when content grows (new messages, artifacts loading, etc.)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const content = el.firstElementChild
    if (!content) return

    let prevHeight = content.scrollHeight

    const observer = new ResizeObserver(() => {
      const newHeight = content.scrollHeight
      const grew = newHeight > prevHeight
      prevHeight = newHeight
      if (grew && hasScrolledToBottom.current && shouldAutoScroll.current) {
        el.scrollTop = el.scrollHeight
      }
    })

    observer.observe(content)
    return () => observer.disconnect()
  }, [sessionId])

  function handleScroll() {
    if (!hasScrolledToBottom.current) return
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 100
  }

  return {
    scrollRef,
    handleScroll,
  }
}
