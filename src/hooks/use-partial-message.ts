import { useCallback, useEffect, useRef, useState } from "react"

// ---------------------------------------------------------------------------
// Stream event types (from SDK partial assistant messages)
// ---------------------------------------------------------------------------

interface ContentBlockStartText {
  type: "content_block_start"
  index: number
  content_block: { type: "text"; text: string }
}

interface ContentBlockStartThinking {
  type: "content_block_start"
  index: number
  content_block: { type: "thinking"; thinking: string }
}

interface ContentBlockStartToolUse {
  type: "content_block_start"
  index: number
  content_block: { type: "tool_use"; id: string; name: string; input: string }
}

interface ContentBlockDeltaText {
  type: "content_block_delta"
  index: number
  delta: { type: "text_delta"; text: string }
}

interface ContentBlockDeltaThinking {
  type: "content_block_delta"
  index: number
  delta: { type: "thinking_delta"; thinking: string }
}

interface ContentBlockDeltaInputJson {
  type: "content_block_delta"
  index: number
  delta: { type: "input_json_delta"; partial_json: string }
}

interface ContentBlockStop {
  type: "content_block_stop"
  index: number
}

interface MessageStop {
  type: "message_stop"
}

type StreamEventPayload =
  | ContentBlockStartText
  | ContentBlockStartThinking
  | ContentBlockStartToolUse
  | ContentBlockDeltaText
  | ContentBlockDeltaThinking
  | ContentBlockDeltaInputJson
  | ContentBlockStop
  | MessageStop

export interface StreamEvent {
  type: "stream_event"
  session_id: string
  parent_tool_use_id: string | null
  uuid: string
  event: StreamEventPayload
}

// ---------------------------------------------------------------------------
// Partial message shape exposed to consumers
// ---------------------------------------------------------------------------

export interface PartialMessage {
  text: string
  thinking: string
  isPartial: true
}

// ---------------------------------------------------------------------------
// Accumulator (mutable, lives in a ref)
// ---------------------------------------------------------------------------

interface BlockAccumulator {
  type: "text" | "thinking" | "tool_use"
  content: string
}

interface Accumulator {
  blocks: Map<number, BlockAccumulator>
}

function createAccumulator(): Accumulator {
  return { blocks: new Map() }
}

function accumulatorToPartial(acc: Accumulator): PartialMessage | null {
  if (acc.blocks.size === 0) return null

  let text = ""
  let thinking = ""

  for (const block of acc.blocks.values()) {
    if (block.type === "text") {
      if (text) text += "\n"
      text += block.content
    } else if (block.type === "thinking") {
      if (thinking) thinking += "\n"
      thinking += block.content
    }
    // tool_use blocks are intentionally omitted — they appear when complete
  }

  if (!text && !thinking) return null

  return { text, thinking, isPartial: true }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePartialMessage(sessionId: string) {
  const accRef = useRef<Accumulator>(createAccumulator())
  const rafRef = useRef<number>(0)
  const [partial, setPartial] = useState<PartialMessage | null>(null)
  const sessionRef = useRef(sessionId)

  // Reset on session change
  useEffect(() => {
    if (sessionRef.current !== sessionId) {
      sessionRef.current = sessionId
      accRef.current = createAccumulator()
      setPartial(null)
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
  }, [sessionId])

  const scheduleFlush = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      setPartial(accumulatorToPartial(accRef.current))
    })
  }, [])

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    // Ignore subagent events
    if (event.parent_tool_use_id !== null) return

    const acc = accRef.current
    const evt = event.event

    switch (evt.type) {
      case "content_block_start": {
        const block = evt.content_block
        if (block.type === "text") {
          acc.blocks.set(evt.index, { type: "text", content: block.text })
        } else if (block.type === "thinking") {
          acc.blocks.set(evt.index, { type: "thinking", content: block.thinking })
        } else if (block.type === "tool_use") {
          acc.blocks.set(evt.index, { type: "tool_use", content: "" })
        }
        scheduleFlush()
        break
      }

      case "content_block_delta": {
        const existing = acc.blocks.get(evt.index)
        if (!existing) break

        if (evt.delta.type === "text_delta") {
          existing.content += evt.delta.text
        } else if (evt.delta.type === "thinking_delta") {
          existing.content += evt.delta.thinking
        }
        // input_json_delta intentionally ignored — tool_use blocks not shown during streaming
        scheduleFlush()
        break
      }

      case "content_block_stop":
        // No accumulator change — flush not needed
        break

      case "message_stop":
        // Partial stays visible until caller invokes clear() after the complete message arrives
        break
    }
  }, [scheduleFlush])

  const clear = useCallback(() => {
    accRef.current = createAccumulator()
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    setPartial(null)
  }, [])

  return {
    partialMessage: partial,
    hasPartialMessage: partial !== null,
    handleStreamEvent,
    clear,
  }
}
