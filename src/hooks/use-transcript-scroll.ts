import { useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react"
import { useVirtualizerSafe } from "./use-virtualizer-safe"
import type { SessionMessage } from "@/types"
import type { TranscriptVisibility } from "@/components/session/SessionTranscript"

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
  const settling = useRef(true)
  const prevTotalRef = useRef(0)

  const visibleMessages = useMemo(
    () => messages.filter((message) => shouldRenderMessage(message, visibility)),
    [messages, visibility, shouldRenderMessage],
  )

  // Per-item height estimate. Must be <= actual height to avoid the
  // "Maximum update depth exceeded" cascade.
  const estimateSize = useCallback((index: number) => {
    const msg = visibleMessages[index]
    if (!msg) return 44
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
  }, [visibleMessages])

  // Start at the bottom — virtualizer clamps to max scroll position
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

  // Reset when session changes
  useEffect(() => {
    settling.current = true
    shouldAutoScroll.current = true
    prevTotalRef.current = 0
  }, [sessionId])

  // Bottom-anchor: pin scrollTop to the bottom during settling.
  // useLayoutEffect runs before paint so no intermediate positions are visible.
  useLayoutEffect(() => {
    if (!settling.current) return
    const el = scrollRef.current
    if (!el || visibleMessages.length === 0) return

    el.scrollTop = el.scrollHeight

    // Stop settling once total size stabilizes
    const total = virtualizer.getTotalSize()
    if (total === prevTotalRef.current && total > 0) {
      settling.current = false
    }
    prevTotalRef.current = total
  })

  // Auto-scroll when new messages arrive and user is near the bottom
  const prevCount = useRef(visibleMessages.length)
  useEffect(() => {
    if (settling.current) return
    const didAppend = visibleMessages.length > prevCount.current
    prevCount.current = visibleMessages.length
    if (!didAppend || !shouldAutoScroll.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visibleMessages.length])

  function handleScroll() {
    if (settling.current) return
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
