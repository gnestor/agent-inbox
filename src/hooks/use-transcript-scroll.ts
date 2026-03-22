import { useRef, useEffect, useMemo, useCallback } from "react"
import { useVirtualizerSafe } from "./use-virtualizer-safe"
import type { SessionMessage } from "@/types"
import type { TranscriptVisibility } from "@/components/session/SessionTranscript"

interface UseTranscriptScrollOptions {
  messages: SessionMessage[]
  visibility: TranscriptVisibility
  isStreaming: boolean
  sessionId?: string
  shouldRenderMessage: (message: SessionMessage, visibility: TranscriptVisibility) => boolean
}

export function useTranscriptScroll({
  messages,
  visibility,
  isStreaming,
  sessionId,
  shouldRenderMessage,
}: UseTranscriptScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const hasInitialScroll = useRef(false)
  const previousMessageCount = useRef(0)
  const scrollRaf = useRef<number | null>(null)

  const visibleMessages = useMemo(
    () => messages.filter((message) => shouldRenderMessage(message, visibility)),
    [messages, visibility, shouldRenderMessage],
  )

  // Per-item height estimate. Must be <= actual height to avoid the
  // "Maximum update depth exceeded" cascade (overestimates add items
  // to the window → more measurements → deeper cascade).
  const estimateSize = useCallback((index: number) => {
    const msg = visibleMessages[index]
    if (!msg) return 44
    const payload = msg.message
    // Artifact tool calls render iframes — much taller than accordions
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
  }, [visibleMessages])

  const virtualizer = useVirtualizerSafe({
    count: visibleMessages.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => visibleMessages[index]?.sequence ?? index,
    estimateSize,
    overscan: 10,
    // Defers ResizeObserver callbacks to requestAnimationFrame so accordion open
    // animations (which fire ResizeObserver ~60×/sec) don't trigger synchronous
    // React state updates during the commit phase.
    useAnimationFrameWithResizeObserver: true,
  })

  // Reset scroll state when session changes
  useEffect(() => {
    hasInitialScroll.current = false
    shouldAutoScroll.current = true
    previousMessageCount.current = 0
    if (scrollRaf.current !== null) {
      cancelAnimationFrame(scrollRaf.current)
      scrollRaf.current = null
    }
  }, [sessionId])

  // Auto-scroll to bottom on new messages during streaming
  useEffect(() => {
    if (visibleMessages.length === 0) {
      previousMessageCount.current = 0
      return
    }

    const hadMessages = previousMessageCount.current > 0
    const didAppend = visibleMessages.length > previousMessageCount.current
    previousMessageCount.current = visibleMessages.length

    const isInitial = !hasInitialScroll.current
    const shouldScrollToBottom =
      isInitial || (isStreaming && hadMessages && didAppend && shouldAutoScroll.current)

    if (!shouldScrollToBottom) return

    hasInitialScroll.current = true
    if (scrollRaf.current !== null) {
      cancelAnimationFrame(scrollRaf.current)
    }

    if (isInitial) {
      // Initial load: scroll to bottom after virtualizer settles.
      // Keep scrolling each frame until scrollTop sticks at the bottom.
      let attempts = 0
      const scrollToBottom = () => {
        const el = scrollRef.current
        if (!el || attempts > 10) { scrollRaf.current = null; return }
        el.scrollTop = el.scrollHeight
        attempts++
        scrollRaf.current = requestAnimationFrame(scrollToBottom)
      }
      scrollRaf.current = requestAnimationFrame(scrollToBottom)
    } else {
      // Streaming: single scroll to bottom
      scrollRaf.current = requestAnimationFrame(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
        scrollRaf.current = null
      })
    }
  }, [isStreaming, visibleMessages.length, virtualizer])

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (scrollRaf.current !== null) {
        cancelAnimationFrame(scrollRaf.current)
      }
    }
  }, [])

  function handleScroll() {
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
