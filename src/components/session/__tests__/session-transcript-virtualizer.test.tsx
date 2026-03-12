// @vitest-environment jsdom
import "@testing-library/jest-dom"
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { SessionTranscript } from "../SessionTranscript"
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
    type: "message",
    message: {
      role: i % 3 === 0 ? "user" : "assistant",
      content:
        i % 3 === 0
          ? "OK"
          : [{ type: "tool_use", id: `t${i}`, name: "Read", input: { path: `/f/${i}` } }],
    },
    createdAt: new Date().toISOString(),
  } satisfies SessionMessage))
}

// Mocks getBoundingClientRect for all elements to return a small height (40px).
// This simulates the real-browser condition where items measure BELOW estimateSize (44px),
// which causes TanStack Virtual to shrink the total scroll height, pull more items into
// the virtual window, attach more measureElement refs, dispatch more state updates, and
// eventually hit React 19's 50-nested-update limit ("Maximum update depth exceeded").
const MOCK_ITEM_HEIGHT = 40 // intentionally below estimateSize: 44

describe("SessionTranscript virtualizer — cascade prevention", () => {
  let getBCRSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    getBCRSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({
        height: MOCK_ITEM_HEIGHT,
        width: 400,
        top: 0,
        left: 0,
        bottom: MOCK_ITEM_HEIGHT,
        right: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRectReadOnly)
  })

  afterEach(() => {
    getBCRSpy.mockRestore()
  })

  it("does not log Maximum update depth exceeded with 100 messages", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    render(withQueryClient(<SessionTranscript messages={makeMessages(100)} isStreaming={false} />))

    const cascadeErrors = errorSpy.mock.calls.filter((call) =>
      call.some(
        (arg) =>
          typeof arg === "string" && arg.includes("Maximum update depth exceeded"),
      ),
    )
    expect(cascadeErrors).toHaveLength(0)
    errorSpy.mockRestore()
  })

  it("renders without throwing when items measure below estimateSize", () => {
    expect(() =>
      render(withQueryClient(<SessionTranscript messages={makeMessages(60)} isStreaming={false} />)),
    ).not.toThrow()
  })
})
