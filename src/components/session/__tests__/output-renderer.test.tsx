// @vitest-environment jsdom
import "@testing-library/jest-dom"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { OutputRenderer } from "../OutputRenderer"

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

vi.mock("@/hooks/use-preferences", () => ({
  usePreference: (_key: string, defaultValue: unknown) => [defaultValue, vi.fn()],
}))

vi.mock("@/api/client", () => ({
  resumeSession: vi.fn(),
  getSessionFileUrl: (sid: string, name: string) => `/api/sessions/${sid}/files/${encodeURIComponent(name)}`,
}))

// Mock Babel transform — dynamic import of @babel/standalone is slow and flaky in jsdom.
// The test only verifies ArtifactFrame renders an iframe for a successful transform.
vi.mock("@hammies/frontend/lib/artifact-transform", () => ({
  transformArtifactCode: vi.fn(async (code: string) => ({ code, exportedName: "App" })),
  escapeForScript: (code: string) => code,
  unwrapReactData: (data: unknown) => {
    if (data && typeof data === "object") {
      const o = data as Record<string, unknown>
      return { code: typeof o.code === "string" ? o.code : undefined, title: undefined }
    }
    return { code: typeof data === "string" ? data : undefined, title: undefined }
  },
}))

describe("OutputRenderer", () => {
  it("renders markdown content", () => {
    render(
      <OutputRenderer
        spec={{ type: "markdown", data: "# Hello World" }}
        sessionId="test-session"
        sequence={0}
      />
    )
    // ReactMarkdown renders h1
    const heading = screen.getByRole("heading", { level: 1 })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveTextContent("Hello World")
  })

  it("renders json data as preformatted text", () => {
    const data = { key: "value", num: 42 }
    render(
      <OutputRenderer
        spec={{ type: "json", data }}
        sessionId="test-session"
        sequence={0}
      />
    )
    expect(screen.getByText(/key/)).toBeInTheDocument()
    expect(screen.getByText(/value/)).toBeInTheDocument()
  })

  it("renders table with columns and rows", () => {
    const tableData = {
      columns: ["Name", "Age"],
      rows: [["Alice", 30], ["Bob", 25]],
    }
    render(
      <OutputRenderer
        spec={{ type: "table", data: tableData }}
        sessionId="test-session"
        sequence={0}
      />
    )
    expect(screen.getByText("Name")).toBeInTheDocument()
    expect(screen.getByText("Age")).toBeInTheDocument()
    expect(screen.getByText("Alice")).toBeInTheDocument()
    expect(screen.getByText("Bob")).toBeInTheDocument()
  })

  it("renders file card with name", () => {
    const fileData = { name: "report.pdf", path: "output/report.pdf" }
    render(
      <OutputRenderer
        spec={{ type: "file", data: fileData }}
        sessionId="test-session"
        sequence={0}
      />
    )
    expect(screen.getByText("report.pdf")).toBeInTheDocument()
  })

  it("renders conversation messages", () => {
    const convData = {
      messages: [
        { role: "user", content: "Hello agent" },
        { role: "assistant", content: "Hello user" },
      ],
    }
    render(
      <OutputRenderer
        spec={{ type: "conversation", data: convData }}
        sessionId="test-session"
        sequence={0}
      />
    )
    expect(screen.getByText("Hello agent")).toBeInTheDocument()
    expect(screen.getByText("Hello user")).toBeInTheDocument()
  })

  it("renders html in an iframe", () => {
    const { container } = render(
      <OutputRenderer
        spec={{ type: "html", data: "<h1>Test</h1>" }}
        sessionId="test-session"
        sequence={0}
      />
    )
    const iframe = container.querySelector("iframe")
    expect(iframe).toBeInTheDocument()
    expect(iframe?.getAttribute("sandbox")).toContain("allow-scripts")
  })

  it("renders react artifact in sandboxed iframe with CSP", async () => {
    const { container } = render(
      <Wrapper>
        <OutputRenderer
          spec={{ type: "react", data: { code: "function App() { return <div>hi</div> }" } }}
          sessionId="test-session"
          sequence={0}
        />
      </Wrapper>
    )
    // Transform is async (React Query) — wait for iframe to appear
    await vi.waitFor(() => {
      expect(container.querySelector("iframe")).toBeInTheDocument()
    })
    const iframe = container.querySelector("iframe")
    // allow-same-origin needed for ES module imports; CSP blocks network access
    expect(iframe?.getAttribute("sandbox")).toContain("allow-scripts")
    expect(iframe?.getAttribute("sandbox")).toContain("allow-same-origin")
  })

  it("renders content directly without card wrapper when fillPanel is true", () => {
    const { container } = render(
      <OutputRenderer
        spec={{ type: "markdown", data: "# Panel content" }}
        sessionId="test-session"
        sequence={1}
        fillPanel
      />
    )
    // Should not have the border card wrapper
    expect(container.querySelector(".border")).toBeNull()
    // Should still render the content
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Panel content")
  })
})

/**
 * How far an artifact panel's content sits from the panel edge.
 *
 * The rule and its roster are shared with Studio (`needsPanelInset`), so an
 * output type reads the same in both apps. The panel itself used to pad every
 * type, which doubled the inset on the types that pad their own body.
 */
describe("the panel inset", () => {
  // 20 rows — comfortably past `DataTable`'s own >5-row default, so what these
  // cases assert is the HOST's decision and not that default leaking through.
  const table = {
    columns: ["SKU", "Qty"],
    rows: Array.from({ length: 20 }, (_, i) => [`BKN-${i}`, i]),
  }

  it("Scenario: An expanded data grid insets, and its filter field stays at the panel edge", () => {
    const { container } = render(
      <Wrapper>
        <OutputRenderer spec={{ type: "table", data: table }} sessionId="s" sequence={1} fillPanel />
      </Wrapper>,
    )
    expect(container.querySelector("[data-slot=table-container]")?.closest(".p-4")).not.toBeNull()
    expect(container.querySelector('input[placeholder="Filter..."]')?.closest(".p-4")).toBeNull()
  })

  it("Scenario: An expanded output that pads itself nowhere takes the inset from the renderer", () => {
    const { container } = render(
      <Wrapper>
        <OutputRenderer spec={{ type: "json", data: { a: 1 } }} sessionId="s" sequence={1} fillPanel />
      </Wrapper>,
    )
    expect(container.querySelectorAll(".h-full.p-4")).toHaveLength(1)
  })

  it.each(["markdown", "conversation", "html"] as const)(
    "An expanded %s output gains no second inset",
    (type) => {
      const data = type === "conversation"
        ? { messages: [{ role: "user", content: "Hammies" }] }
        : "Hammies"
      const { container } = render(
        <Wrapper>
          <OutputRenderer spec={{ type, data } as never} sessionId="s" sequence={1} fillPanel />
        </Wrapper>,
      )
      expect(container.querySelectorAll(".h-full.p-4")).toHaveLength(0)
    },
  )
})
