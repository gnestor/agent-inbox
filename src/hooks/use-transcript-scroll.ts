import { useRef, useEffect, useMemo, useCallback } from "react"
import { useVirtualizerSafe } from "./use-virtualizer-safe"
import type { SessionMessage } from "@/types"
import type { TranscriptVisibility } from "@/components/session/SessionTranscript"

// Module-level cache: measured row heights persist across remounts.
// Key: "sessionId:sequence", Value: measured height in px.
// Capped at 5000 entries (~10 sessions worth) to prevent unbounded growth.
const heightCache = new Map<string, number>()
const HEIGHT_CACHE_MAX = 5000

interface UseTranscriptScrollOptions {
  messages: SessionMessage[]
  visibility: TranscriptVisibility
  sessionId?: string
  shouldRenderMessage: (message: SessionMessage, visibility: TranscriptVisibility) => boolean
}

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

  // Use cached height if available (from a previous visit), otherwise estimate.
  // Estimates must be <= actual height to avoid the cascade bug.
  const estimateSize = useCallback((index: number) => {
    const msg = visibleMessages[index]
    if (!msg) return 44
    const cached = sessionId ? heightCache.get(`${sessionId}:${msg.sequence}`) : undefined
    if (cached) return cached
    const payload = msg.message
    if (payload.type === "assistant") {
      const blocks = Array.isArray(payload.content) ? payload.content
        : Array.isArray((payload as any).message?.content) ? (payload as any).message.content
        : []
      for (const b of blocks) {
        if (b.type === "tool_use" && (b.name === "render_output" || b.name === "mcp__render_output__render_output")) {
          return 200
        }
      }
    }
    return 44
  }, [visibleMessages, sessionId])

  // Start at the bottom
  const initialOffset = useMemo(() => {
    let total = 0
    for (let i = 0; i < visibleMessages.length; i++) total += estimateSize(i)
    return total
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- only on mount

  const virtualizer = useVirtualizerSafe({
    count: visibleMessages.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => visibleMessages[index]?.sequence ?? index,
    estimateSize,
    overscan: 5,
    initialOffset,
    useAnimationFrameWithResizeObserver: true,
  })

  // Cache measured heights so revisits use correct sizes from frame 1
  useEffect(() => {
    if (!sessionId) return
    const measurements = virtualizer.getVirtualItems()
    for (const item of measurements) {
      if (item.size > 0) {
        heightCache.set(`${sessionId}:${visibleMessages[item.index]?.sequence}`, item.size)
      }
    }
    // Evict oldest entries when cache exceeds limit
    if (heightCache.size > HEIGHT_CACHE_MAX) {
      const excess = heightCache.size - HEIGHT_CACHE_MAX
      const iter = heightCache.keys()
      for (let i = 0; i < excess; i++) {
        const key = iter.next().value
        if (key) heightCache.delete(key)
      }
    }
  })

  // Reset when session changes
  useEffect(() => {
    hasScrolledToBottom.current = false
    shouldAutoScroll.current = true
  }, [sessionId])

  // Scroll to the last item once messages are available.
  // Uses virtualizer.scrollToIndex which works with the virtualizer's
  // measurement system rather than fighting it with raw scrollTop.
  useEffect(() => {
    if (hasScrolledToBottom.current) return
    if (visibleMessages.length === 0) return

    hasScrolledToBottom.current = true
    const lastIndex = visibleMessages.length - 1

    // scrollToIndex needs a frame for the virtualizer to initialize
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(lastIndex, { align: "end" })
      // Second call after measurements settle
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(lastIndex, { align: "end" })
      })
    })
  }, [visibleMessages.length, virtualizer])

  // Auto-scroll when new messages arrive and user is near the bottom
  const prevCount = useRef(visibleMessages.length)
  useEffect(() => {
    if (!hasScrolledToBottom.current) return
    const didAppend = visibleMessages.length > prevCount.current
    prevCount.current = visibleMessages.length
    if (!didAppend || !shouldAutoScroll.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visibleMessages.length])

  function handleScroll() {
    if (!hasScrolledToBottom.current) return
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 100
  }

  return {
    scrollRef,
    virtualizer,
    visibleMessages,
    handleScroll,
  }
}
