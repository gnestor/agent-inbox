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

  it("embeds simple code as base64 in data attribute", () => {
    const code = 'function App() { return <div>Hello</div> }'
    const html = buildArtifactHtml(code)
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain('data-code="')
    // Decode the base64 from the data attribute
    const match = html.match(/data-code="([^"]+)"/)
    expect(match).not.toBeNull()
    const decoded = decodeURIComponent(escape(atob(match![1])))
    expect(decoded).toBe(code)
  })

  it("handles code with newlines and special characters", () => {
    const code = `function App() {
  const [count, setCount] = useState(0);
  return (
    <div className="card">
      <h1>Count: {count}</h1>
      <button onClick={() => setCount(c => c + 1)}>+</button>
      <p>Special chars: "quotes" & <angles> \\ backslash</p>
    </div>
  );
}`
    const html = buildArtifactHtml(code)
    const match = html.match(/data-code="([^"]+)"/)
    expect(match).not.toBeNull()
    const decoded = decodeURIComponent(escape(atob(match![1])))
    expect(decoded).toBe(code)
  })

  it("handles code with unicode characters", () => {
    const code = 'function App() { return <div>Hello 🌍 café naïve</div> }'
    const html = buildArtifactHtml(code)
    const match = html.match(/data-code="([^"]+)"/)
    expect(match).not.toBeNull()
    const decoded = decodeURIComponent(escape(atob(match![1])))
    expect(decoded).toBe(code)
  })

  it("escapes HTML in title", () => {
    const html = buildArtifactHtml("function App() {}", '<script>alert("xss")</script>')
    expect(html).not.toContain("<script>alert")
    expect(html).toContain("&lt;script&gt;alert")
  })

  it("uses default title when none provided", () => {
    const html = buildArtifactHtml("function App() {}")
    expect(html).toContain("<title>Artifact</title>")
  })

  it("includes React and Babel script tags", () => {
    const html = buildArtifactHtml("function App() {}")
    expect(html).toContain("babel.min.js")
    expect(html).toContain("react.development.js")
    expect(html).toContain("react-dom")
  })

  it("includes component stubs (Button, Card, Badge)", () => {
    const html = buildArtifactHtml("function App() {}")
    expect(html).toContain("function Button(")
    expect(html).toContain("function Card(")
    expect(html).toContain("function Badge(")
  })

  it("includes postMessage bridge helpers", () => {
    const html = buildArtifactHtml("function App() {}")
    expect(html).toContain("__sendAction")
    expect(html).toContain("__saveState")
    expect(html).toContain("__onStateRestored")
  })

  it("data attribute value contains no unescaped quotes", () => {
    // Code with lots of quotes that previously broke the attribute
    const code = `const msg = "hello 'world'";
const obj = { "key": "value", 'other': 'val' };
function App() { return <div data-x="test">hi</div> }`
    const html = buildArtifactHtml(code)
    // The data-code attribute should be properly quoted
    const match = html.match(/data-code="([^"]*)"/)
    expect(match).not.toBeNull()
    const decoded = decodeURIComponent(escape(atob(match![1])))
    expect(decoded).toBe(code)
  })

  it("bootstrap strips import statements via line-by-line parsing", () => {
    const html = buildArtifactHtml("function App() {}")
    // Should use line-by-line import stripping, not regex on full string
    expect(html).toContain("trimStart()")
    expect(html).toContain("^import")
  })

  it("bootstrap uses only the react preset (no env/CommonJS)", () => {
    const html = buildArtifactHtml("function App() {}")
    expect(html).toContain("presets: ['react']")
    expect(html).not.toContain("'env'")
  })

  it("includes additional hooks in stubs (useReducer, useContext, createContext)", () => {
    const html = buildArtifactHtml("function App() {}")
    expect(html).toContain("useReducer")
    expect(html).toContain("useContext")
    expect(html).toContain("createContext")
  })

  it("bootstrap detects exported default component name", () => {
    const html = buildArtifactHtml("export default function EmailEditor() {}")
    // Should track exportedName and use it for rendering
    expect(html).toContain("exportedName")
    expect(html).toContain("RootComponent")
  })

  it("bootstrap falls back to any PascalCase component if no App", () => {
    const html = buildArtifactHtml("function FileTable() {}")
    // Should scan for PascalCase functions as fallback
    expect(html).toContain("componentMatch")
    expect(html).toContain("[A-Z]")
  })

  it("bootstrap fixes multiline regex literals (LLM /\\n/ mistake)", () => {
    const html = buildArtifactHtml("function App() {}")
    // Should contain the fixup that replaces /⏎/g with /\n/g
    expect(html).toContain("Fix common LLM mistake")
    expect(html).toContain("userCode.replace(")
  })
})
