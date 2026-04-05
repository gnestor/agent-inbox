// @vitest-environment jsdom
import React, { type MutableRefObject } from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, act } from "@testing-library/react"
import { useIframeAutoHeight } from "../use-iframe-auto-height"
import { renderHook } from "@testing-library/react"

// ---------------------------------------------------------------------------
// Mock ResizeObserver + MutationObserver (jsdom doesn't provide them)
// ---------------------------------------------------------------------------

interface ObserverInstance {
  cb: (...args: unknown[]) => void
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

let resizeObserverInstances: ObserverInstance[] = []
let mutationObserverInstances: ObserverInstance[] = []

class MockResizeObserver {
  static calls: unknown[][] = []
  cb: () => void
  observe = vi.fn()
  disconnect = vi.fn()
  unobserve = vi.fn()
  constructor(cb: () => void) {
    MockResizeObserver.calls.push([cb])
    this.cb = cb
    resizeObserverInstances.push(this)
  }
}

class MockMutationObserver {
  static calls: unknown[][] = []
  cb: (mutations: unknown[]) => void
  observe = vi.fn()
  disconnect = vi.fn()
  constructor(cb: (mutations: unknown[]) => void) {
    MockMutationObserver.calls.push([cb])
    this.cb = cb
    mutationObserverInstances.push(this)
  }
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver)
  vi.stubGlobal("MutationObserver", MockMutationObserver)
  resizeObserverInstances = []
  mutationObserverInstances = []
  MockResizeObserver.calls = []
  MockMutationObserver.calls = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Helper: Component that uses the hook and exposes the ref on a real iframe
// ---------------------------------------------------------------------------

function TestIframe({ srcDoc }: { srcDoc: string }) {
  const { iframeRef } = useIframeAutoHeight(srcDoc)
  return <iframe ref={iframeRef} data-testid="iframe" />
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useIframeAutoHeight", () => {
  it("returns an iframeRef", () => {
    const { result } = renderHook(() => useIframeAutoHeight("<p>hello</p>"))
    expect(result.current.iframeRef).toBeDefined()
    expect(result.current.iframeRef.current).toBeNull()
  })

  it("registers load listener and MutationObserver on mount", () => {
    const { unmount } = render(<TestIframe srcDoc="<p>hello</p>" />)

    // MutationObserver should be created to watch for theme class changes
    expect(mutationObserverInstances.length).toBeGreaterThan(0)
    expect(mutationObserverInstances.length).toBeGreaterThan(0)
    expect(mutationObserverInstances[0].observe).toHaveBeenCalledWith(
      document.documentElement,
      { attributes: true, attributeFilter: ["class"] },
    )

    unmount()
  })

  it("sets iframe height when load event fires", () => {
    const { getByTestId } = render(<TestIframe srcDoc="<p>content</p>" />)
    const iframe = getByTestId("iframe") as HTMLIFrameElement

    // jsdom iframes don't have real contentDocument with body.scrollHeight.
    // We need to mock the contentDocument property.
    const mockBody = { scrollHeight: 350 }
    const mockRoot = { style: { setProperty: vi.fn(), colorScheme: "" } }
    Object.defineProperty(iframe, "contentDocument", {
      value: { body: mockBody, documentElement: mockRoot },
      configurable: true,
    })

    act(() => {
      iframe.dispatchEvent(new Event("load"))
    })

    expect(iframe.style.height).toBe("350px")
  })

  it("creates a ResizeObserver on load to track body resizes", () => {
    const { getByTestId } = render(<TestIframe srcDoc="<p>content</p>" />)
    const iframe = getByTestId("iframe") as HTMLIFrameElement

    const mockBody = { scrollHeight: 200 }
    const mockRoot = { style: { setProperty: vi.fn(), colorScheme: "" } }
    Object.defineProperty(iframe, "contentDocument", {
      value: { body: mockBody, documentElement: mockRoot },
      configurable: true,
    })

    // Clear previous ResizeObserver instances
    resizeObserverInstances = []

    act(() => {
      iframe.dispatchEvent(new Event("load"))
    })

    expect(resizeObserverInstances.length).toBeGreaterThan(0)
    expect(resizeObserverInstances.length).toBe(1)
    expect(resizeObserverInstances[0].observe).toHaveBeenCalledWith(mockBody)

    // Simulate a resize
    mockBody.scrollHeight = 500
    act(() => {
      resizeObserverInstances[0].cb()
    })
    expect(iframe.style.height).toBe("500px")
  })

  it("handles null iframe gracefully (no errors thrown)", () => {
    expect(() => {
      const { unmount } = renderHook(() => useIframeAutoHeight("<p>test</p>"))
      unmount()
    }).not.toThrow()
  })

  it("handles missing contentDocument body gracefully", () => {
    const { getByTestId } = render(<TestIframe srcDoc="<p>test</p>" />)
    const iframe = getByTestId("iframe") as HTMLIFrameElement

    Object.defineProperty(iframe, "contentDocument", {
      value: { body: null, documentElement: { style: { setProperty: vi.fn(), colorScheme: "" } } },
      configurable: true,
    })

    // Should not throw when load fires with null body
    expect(() => {
      act(() => { iframe.dispatchEvent(new Event("load")) })
    }).not.toThrow()

    // ResizeObserver should NOT be created when body is null
    // (only MutationObserver for theme would have been created on mount)
  })

  it("disconnects observers on cleanup", () => {
    const { getByTestId, unmount } = render(<TestIframe srcDoc="<p>test</p>" />)
    const iframe = getByTestId("iframe") as HTMLIFrameElement

    const mockBody = { scrollHeight: 100 }
    const mockRoot = { style: { setProperty: vi.fn(), colorScheme: "" } }
    Object.defineProperty(iframe, "contentDocument", {
      value: { body: mockBody, documentElement: mockRoot },
      configurable: true,
    })

    act(() => { iframe.dispatchEvent(new Event("load")) })

    const roInst = resizeObserverInstances.at(-1)!
    const moInst = mutationObserverInstances.at(-1)!

    unmount()

    expect(roInst.disconnect).toHaveBeenCalled()
    expect(moInst.disconnect).toHaveBeenCalled()
  })

  it("syncs theme colorScheme based on parent dark class", () => {
    const { getByTestId } = render(<TestIframe srcDoc="<p>test</p>" />)
    const iframe = getByTestId("iframe") as HTMLIFrameElement

    const mockRoot = { style: { setProperty: vi.fn(), colorScheme: "" } }
    const mockBody = { scrollHeight: 100 }
    Object.defineProperty(iframe, "contentDocument", {
      value: { body: mockBody, documentElement: mockRoot },
      configurable: true,
    })

    // No dark class → colorScheme = "light"
    document.documentElement.classList.remove("dark")
    act(() => { iframe.dispatchEvent(new Event("load")) })
    expect(mockRoot.style.colorScheme).toBe("light")

    // Add dark class → colorScheme = "dark"
    document.documentElement.classList.add("dark")
    act(() => { iframe.dispatchEvent(new Event("load")) })
    expect(mockRoot.style.colorScheme).toBe("dark")

    // Clean up
    document.documentElement.classList.remove("dark")
  })
})
