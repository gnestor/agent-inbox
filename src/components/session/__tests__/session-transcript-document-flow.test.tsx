// @vitest-environment jsdom
import "@testing-library/jest-dom"

// jsdom doesn't provide ResizeObserver, which the scroll hook observes with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver
Element.prototype.scrollTo ??= function scrollTo() {}

import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  SessionTranscript,
  TranscriptHostProvider,
  DEFAULT_TRANSCRIPT_VISIBILITY,
  type TranscriptHost,
} from "@hammies/frontend/components/session"
import { processTranscript, filterVisible } from "@hammies/session-core"
import type { SessionMessage } from "@/types"

/**
 * This file replaces a virtualizer regression test. Inbox used to window the
 * transcript with `estimateSize: () => 72`, and that test guarded against the
 * render cascade ("Maximum update depth exceeded") that fired when real heights
 * measured below the estimate.
 *
 * The transcript now renders in document flow at real heights — estimate-based
 * windowing visibly jumps the viewport on WebKit, which has no scroll anchoring
 * and is every iOS browser. The cascade is therefore structurally impossible.
 * What is still worth pinning is the property that replaced it: a large
 * transcript renders EVERY message, with no windowing and no cascade.
 */

const host: TranscriptHost = {
  renderOutput: () => null,
  fileUrl: (runId, filename) => `/files/${runId}/${filename}`,
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <TranscriptHostProvider host={host}>{ui}</TranscriptHostProvider>
    </QueryClientProvider>
  )
}

function makeMessages(count: number): SessionMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    sessionId: "test-session",
    sequence: i,
    type: i % 2 === 0 ? "user" : "assistant",
    message:
      i % 2 === 0
        ? { type: "user" as const, content: `message ${i}`, uuid: `u${i}` }
        : { type: "assistant" as const, uuid: `a${i}`, content: [{ type: "text" as const, text: `reply ${i}` }] },
    createdAt: new Date().toISOString(),
  })) as unknown as SessionMessage[]
}

function processMessages(raw: SessionMessage[]) {
  const { lookups, classified } = processTranscript(raw)
  return { lookups, messages: filterVisible(classified, DEFAULT_TRANSCRIPT_VISIBILITY) }
}

describe("SessionTranscript document flow", () => {
  it("renders every message, not a windowed subset", () => {
    const { lookups, messages } = processMessages(makeMessages(100))
    const { getByText } = render(
      wrap(
        <SessionTranscript
          messages={messages}
          lookups={lookups}
          userProfiles={new Map()}
          visibility={DEFAULT_TRANSCRIPT_VISIBILITY}
          sessionId="test-session"
        />,
      ),
    )
    // First, middle and last are all in the DOM — a virtualizer would drop the tails.
    expect(getByText("message 0")).toBeInTheDocument()
    expect(getByText("reply 51")).toBeInTheDocument()
    expect(getByText("reply 99")).toBeInTheDocument()
  })

  it("does not log Maximum update depth exceeded on a large transcript", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { lookups, messages } = processMessages(makeMessages(100))
    render(
      wrap(
        <SessionTranscript
          messages={messages}
          lookups={lookups}
          userProfiles={new Map()}
          visibility={DEFAULT_TRANSCRIPT_VISIBILITY}
          sessionId="test-session"
        />,
      ),
    )
    const cascades = errorSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("Maximum update depth exceeded")),
    )
    expect(cascades).toHaveLength(0)
    errorSpy.mockRestore()
  })
})
