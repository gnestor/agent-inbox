// @vitest-environment jsdom
import "@testing-library/jest-dom"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { OutputRenderer } from "../OutputRenderer"

vi.mock("@/hooks/use-preferences", () => ({
  usePreference: (_key: string, defaultValue: unknown) => [defaultValue, vi.fn()],
}))

vi.mock("@/api/client", () => ({
  resumeSession: vi.fn(),
  getSessionFileUrl: (sid: string, name: string) => `/api/sessions/${sid}/files/${encodeURIComponent(name)}`,
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

  it("renders react artifact in sandboxed iframe with CSP", () => {
    const { container } = render(
      <OutputRenderer
        spec={{ type: "react", data: { code: "function App() { return <div>hi</div> }" } }}
        sessionId="test-session"
        sequence={0}
      />
    )
    const iframe = container.querySelector("iframe")
    expect(iframe).toBeInTheDocument()
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
