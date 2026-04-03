// @vitest-environment jsdom
import "@testing-library/jest-dom"

// jsdom doesn't provide ResizeObserver
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SessionTranscript } from "../SessionTranscript"
import { processTranscript, filterVisible } from "@/lib/session-pipeline"
import { DEFAULT_TRANSCRIPT_VISIBILITY } from "../SessionTranscript"
import type { SessionMessage } from "@/types"

vi.mock("@/hooks/use-preferences", () => ({
  usePreference: (_key: string, defaultValue: unknown) => [defaultValue, vi.fn()],
}))

vi.mock("@/api/client", () => ({
  getPanelSchemas: () => Promise.resolve({}),
}))

function withQueryClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

function makeMessages(count: number): SessionMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    sessionId: "test-session",
    sequence: i,
    type: i % 3 === 0 ? "user" : "assistant",
    message: i % 3 === 0
      ? { type: "user" as const, content: "OK" }
      : { type: "assistant" as const, content: [{ type: "tool_use" as const, id: `t${i}`, name: "Read", input: { path: `/f/${i}` } }] },
    createdAt: new Date().toISOString(),
  } satisfies SessionMessage))
}

function processMessages(raw: SessionMessage[]) {
  const { lookups, classified } = processTranscript(raw)
  const messages = filterVisible(classified, DEFAULT_TRANSCRIPT_VISIBILITY)
  return { lookups, messages }
}

const MOCK_ITEM_HEIGHT = 40

describe("SessionTranscript virtualizer — cascade prevention", () => {
  let getBCRSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    }

    getBCRSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({
        height: MOCK_ITEM_HEIGHT,
        width: 400,
        top: 0, left: 0, bottom: MOCK_ITEM_HEIGHT, right: 400, x: 0, y: 0,
        toJSON: () => ({}),
      } as DOMRectReadOnly)
  })

  afterEach(() => {
    getBCRSpy.mockRestore()
  })

  it("does not log Maximum update depth exceeded with 100 messages", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { lookups, messages } = processMessages(makeMessages(100))

    render(withQueryClient(
      <SessionTranscript messages={messages} lookups={lookups} userProfiles={new Map()} visibility={DEFAULT_TRANSCRIPT_VISIBILITY} />
    ))

    const cascadeErrors = errorSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && arg.includes("Maximum update depth exceeded")),
    )
    expect(cascadeErrors).toHaveLength(0)
    errorSpy.mockRestore()
  })

  it("renders without throwing when items measure below estimateSize", () => {
    const { lookups, messages } = processMessages(makeMessages(60))

    expect(() =>
      render(withQueryClient(
        <SessionTranscript messages={messages} lookups={lookups} userProfiles={new Map()} visibility={DEFAULT_TRANSCRIPT_VISIBILITY} />
      )),
    ).not.toThrow()
  })
})
