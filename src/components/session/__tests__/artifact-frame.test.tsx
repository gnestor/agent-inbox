// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { buildArtifactHtml } from "../ArtifactFrame"

describe("buildArtifactHtml", () => {
  it("returns fallback HTML when code is undefined", () => {
    const html = buildArtifactHtml(undefined)
    expect(html).toContain("No artifact code provided")
    expect(html).toContain("<!DOCTYPE html>")
  })

  it("returns fallback HTML when code is empty string", () => {
    const html = buildArtifactHtml("")
    expect(html).toContain("No artifact code provided")
  })

  it("embeds code as base64 in data attribute", () => {
    const code = 'var x = React.createElement("div", null, "Hello");'
    const html = buildArtifactHtml(code)
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain('data-code="')
    const match = html.match(/data-code="([^"]+)"/)
    expect(match).not.toBeNull()
    const decoded = decodeURIComponent(escape(atob(match![1])))
    expect(decoded).toBe(code)
  })

  it("handles code with newlines and special characters", () => {
    const code = `var count = 0;
function App() {
  return React.createElement("div", { className: "card" },
    React.createElement("p", null, "Special: \\"quotes\\" & stuff")
  );
}`
    const html = buildArtifactHtml(code)
    const match = html.match(/data-code="([^"]+)"/)
    expect(match).not.toBeNull()
    const decoded = decodeURIComponent(escape(atob(match![1])))
    expect(decoded).toBe(code)
  })

  it("handles code with unicode characters", () => {
    const code = 'var x = React.createElement("div", null, "Hello 🌍 café naïve");'
    const html = buildArtifactHtml(code)
    const match = html.match(/data-code="([^"]+)"/)
    expect(match).not.toBeNull()
    const decoded = decodeURIComponent(escape(atob(match![1])))
    expect(decoded).toBe(code)
  })

  it("escapes HTML in title", () => {
    const html = buildArtifactHtml("var x = 1;", '<script>alert("xss")</script>')
    expect(html).not.toContain("<script>alert")
    expect(html).toContain("&lt;script&gt;alert")
  })

  it("uses default title when none provided", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("<title>Artifact</title>")
  })

  it("does NOT include Babel CDN (transform happens in parent)", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).not.toContain("babel")
    expect(html).not.toContain("Babel")
  })

  it("includes React and ReactDOM CDN scripts", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("react.development.js")
    expect(html).toContain("react-dom")
  })

  it("includes Tailwind CDN", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("cdn.tailwindcss.com")
  })

  it("includes import map for @hammies/frontend components", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain('<script type="importmap">')
    expect(html).toContain("@hammies/frontend/components/ui")
    expect(html).toContain("@hammies/frontend/lib/utils")
    expect(html).toContain("/@hammies/components.mjs")
  })

  it("includes CSP meta tag blocking fetch/XHR", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("Content-Security-Policy")
    // default-src 'none' blocks connect-src (fetch/XHR) unless explicitly overridden
    expect(html).toContain("default-src 'none'")
  })

  it("does NOT include component stubs (real components via ES module)", () => {
    const html = buildArtifactHtml("var x = 1;")
    // Old stubs defined functions inline — should be gone
    expect(html).not.toContain("function Button(")
    expect(html).not.toContain("function Card(")
    expect(html).not.toContain("function Badge(")
  })

  it("includes postMessage bridge helpers", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("__sendAction")
    expect(html).toContain("__saveState")
    expect(html).toContain("__onStateRestored")
  })

  it("passes exportedName as data-export attribute", () => {
    const html = buildArtifactHtml("function Dashboard() {}", "Test", undefined, "Dashboard")
    expect(html).toContain('data-export="Dashboard"')
  })

  it("sets data-export to empty string when no export", () => {
    const html = buildArtifactHtml("function App() {}", "Test", undefined, null)
    expect(html).toContain('data-export=""')
  })

  it("bootstrap detects component via exportedName, App, or PascalCase", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("exportedName")
    expect(html).toContain("RootComponent")
    expect(html).toContain("[A-Z]")
  })

  it("applies theme variables with fallbacks", () => {
    const themeVars = { background: "oklch(0.5 0 0)", primary: "oklch(0.7 0.2 255)" }
    const html = buildArtifactHtml("var x = 1;", "Test", themeVars)
    expect(html).toContain("--background: oklch(0.5 0 0)")
    expect(html).toContain("--primary: oklch(0.7 0.2 255)")
    // Unset vars should get fallback
    expect(html).toContain("--foreground: #e6edf3")
  })

  it("data attribute value contains no unescaped quotes", () => {
    const code = `var msg = "hello 'world'";
var obj = { "key": "value" };`
    const html = buildArtifactHtml(code)
    const match = html.match(/data-code="([^"]*)"/)
    expect(match).not.toBeNull()
    const decoded = decodeURIComponent(escape(atob(match![1])))
    expect(decoded).toBe(code)
  })
})
