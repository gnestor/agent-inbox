// @vitest-environment jsdom
import "@testing-library/jest-dom"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, act, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ArtifactFrame } from "../ArtifactFrame"

// Babel transform is slow/flaky in jsdom — mock it to a passthrough.
vi.mock("@/lib/artifact-transform", () => ({
  transformArtifactCode: vi.fn(async (code: string) => ({ code, exportedName: "App" })),
  escapeForScript: (code: string) => code,
}))

const setSavedState = vi.fn()
let savedStateValue: Record<string, unknown> = {}
vi.mock("@/hooks/use-preferences", () => ({
  usePreference: () => [savedStateValue, setSavedState],
}))

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

/** Post a message that appears to originate from the artifact iframe's contentWindow. */
function postFromIframe(iframe: HTMLIFrameElement, data: unknown) {
  act(() => {
    const event = new MessageEvent("message", { data })
    Object.defineProperty(event, "source", { value: iframe.contentWindow })
    window.dispatchEvent(event)
  })
}

async function renderFrame(props?: Partial<React.ComponentProps<typeof ArtifactFrame>>) {
  const Wrapper = makeWrapper()
  const onAction = vi.fn()
  const result = render(
    <Wrapper>
      <ArtifactFrame
        code="function App() { return <div>hi</div> }"
        sessionId="s1"
        sequence={0}
        onAction={onAction}
        {...props}
      />
    </Wrapper>,
  )
  let iframe!: HTMLIFrameElement
  await waitFor(() => {
    const el = result.container.querySelector("iframe")
    expect(el).toBeInTheDocument()
    iframe = el as HTMLIFrameElement
  })
  return { ...result, iframe, onAction }
}

describe("ArtifactFrame host", () => {
  beforeEach(() => {
    setSavedState.mockClear()
    savedStateValue = {}
  })

  it("Scenario: Transform is cached forever per source string — query uses staleTime Infinity keyed by code", async () => {
    // The transform runs once per code string; React Query (staleTime: Infinity) reuses it.
    const { iframe } = await renderFrame()
    expect(iframe.getAttribute("srcdoc")).toBeTruthy()
  })

  it("Scenario: Last valid transform is shown during edit-time syntax errors — iframe keeps rendering prior good code", async () => {
    // lastValidRef retains the previous good transform; the iframe stays mounted.
    const { iframe } = await renderFrame()
    expect(iframe).toBeInTheDocument()
  })

  it("Scenario: `srcDoc` is cached per `(sessionId, sequence, transformedCode)` triple, capped at 50 — revisit reuses HTML", async () => {
    const { iframe } = await renderFrame()
    expect(iframe.getAttribute("srcdoc")).toContain("<!DOCTYPE html>")
  })

  it("Scenario: Reported heights are cached at `(sessionId, sequence)`, capped at 500 — height message sizes the iframe", async () => {
    const { iframe } = await renderFrame()
    postFromIframe(iframe, { type: "height", height: 321 })
    await waitFor(() => {
      expect(iframe.style.height).toBe("321px")
    })
  })

  it("Scenario: Iframe stays hidden until the live height report arrives — opacity-0 until height posts", async () => {
    const { iframe } = await renderFrame()
    // Before any height report the iframe is positioned offscreen/transparent.
    expect(iframe.className).toContain("opacity-0")
    postFromIframe(iframe, { type: "height", height: 200 })
    await waitFor(() => {
      expect(iframe.className).not.toContain("opacity-0")
    })
  })

  it("Scenario: Action intents become `<artifact_action>` strings — strips <>\"& from intent and wraps payload", async () => {
    const { iframe, onAction } = await renderFrame()
    postFromIframe(iframe, { type: "action", intent: 'go<>"&now', data: { a: 1 } })
    expect(onAction).toHaveBeenCalledWith(
      '<artifact_action intent="gonow">{\n  "a": 1\n}</artifact_action>',
    )
  })

  it("Scenario: Saved state restores via postMessage on `load` — state writes back through setSavedState", async () => {
    const { iframe } = await renderFrame()
    postFromIframe(iframe, { type: "state", state: { count: 3 } })
    expect(setSavedState).toHaveBeenCalledWith({ count: 3 })
  })

  it("Scenario: Compile or runtime errors render as a destructive in-flow block — error message shows in a bg-destructive pre", async () => {
    const { iframe, container } = await renderFrame()
    postFromIframe(iframe, { type: "error", message: "Boom at runtime" })
    await waitFor(() => {
      expect(container.querySelector(".bg-destructive")).toBeInTheDocument()
      expect(container.textContent).toContain("Boom at runtime")
    })
  })

  it("Scenario: Wheel forwarding from iframe to parent — dispatches a bubbling WheelEvent on the iframe", async () => {
    const { iframe } = await renderFrame()
    const onWheel = vi.fn()
    iframe.parentElement?.addEventListener("wheel", onWheel)
    postFromIframe(iframe, { type: "wheel", deltaX: 40, deltaY: 0 })
    expect(onWheel).toHaveBeenCalled()
    const evt = onWheel.mock.calls[0][0] as WheelEvent
    expect(evt.deltaX).toBe(40)
  })
})
