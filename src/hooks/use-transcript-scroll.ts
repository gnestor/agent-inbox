import { useRef, useEffect, useMemo } from "react"
import type { SessionMessage } from "@/types"
import type { TranscriptVisibility } from "@/components/session/SessionTranscript"

interface UseTranscriptScrollOptions {
  messages: SessionMessage[]
  visibility: TranscriptVisibility
  sessionId?: string
  shouldRenderMessage: (message: SessionMessage, visibility: TranscriptVisibility) => boolean
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
  messages,
  visibility,
  sessionId,
  shouldRenderMessage,
}: UseTranscriptScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const hasScrolledToBottom = useRef(false)

  const visibleMessages = useMemo(
    () => messages.filter((message) => shouldRenderMessage(message, visibility)),
    [messages, visibility, shouldRenderMessage],
  )

  // Reset when session changes
  useEffect(() => {
    hasScrolledToBottom.current = false
    shouldAutoScroll.current = true
  }, [sessionId])

  // Scroll to bottom once messages are available
  useEffect(() => {
    if (hasScrolledToBottom.current) return
    if (visibleMessages.length === 0) return
    const el = scrollRef.current
    if (!el) return

    hasScrolledToBottom.current = true
    // Use rAF to ensure layout has completed
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [visibleMessages.length])

  // Auto-scroll when content grows (new messages, artifacts loading, etc.)
  // Re-create observer when visibility changes so prevHeight resets (toggling
  // tool calls / thinking dramatically changes content height).
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
  }, [sessionId, visibility])

  function handleScroll() {
    if (!hasScrolledToBottom.current) return
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 100
  }

  return {
    scrollRef,
    visibleMessages,
    handleScroll,
  }
}
