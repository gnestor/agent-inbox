// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { buildArtifactHtml } from "@hammies/frontend/lib/build-artifact-html"

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

  it("embeds transformed code as inline module script", () => {
    const code = 'var x = React.createElement("div", null, "Hello");'
    const html = buildArtifactHtml(code)
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain('<script type="module">')
    expect(html).toContain(code)
  })

  it("escapes </script> in embedded code", () => {
    const code = 'var x = "</script>";'
    const html = buildArtifactHtml(code)
    expect(html).not.toContain("</script>;")
    expect(html).toContain("<\\/script")
  })

  it("escapes HTML in title", () => {
    const html = buildArtifactHtml("var x = 1;", { title: '<script>alert("xss")</script>' })
    expect(html).not.toContain("<script>alert")
    expect(html).toContain("&lt;script&gt;alert")
  })

  it("uses default title when none provided", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("<title>Artifact</title>")
  })

  it("does NOT include any external CDN scripts", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).not.toContain("unpkg.com")
    expect(html).not.toContain("cdn.tailwindcss.com")
    expect(html).not.toContain("babel")
  })

  it("loads React and ReactDOM as ES modules from server", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("/@hammies/react.mjs")
    expect(html).toContain("/@hammies/react-dom.mjs")
  })

  it("loads @tailwindcss/browser from server", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("/@hammies/tailwindcss.js")
  })

  it("includes Tailwind v4 theme config via <style type='text/tailwindcss'>", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain('type="text/tailwindcss"')
    expect(html).toContain("@theme inline")
    expect(html).toContain("--color-primary")
    expect(html).toContain("--color-border")
  })

  it("Scenario: Document includes import map, Tailwind CDN, theme @theme block — includes import map for React, ReactDOM, and components", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain('<script type="importmap">')
    expect(html).toContain('"react"')
    expect(html).toContain('"react-dom"')
    expect(html).toContain("@hammies/frontend/components/ui")
    expect(html).toContain("@hammies/frontend/lib/utils")
  })

  it("Scenario: CSP restricts code execution and network — includes CSP meta tag with no external CDN access", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("Content-Security-Policy")
    expect(html).toContain("default-src 'none'")
    // Only allows scripts from our own origin
    expect(html).not.toContain("unpkg.com")
  })

  it("does NOT include component stubs (real components via ES module)", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).not.toContain("function Button(")
    expect(html).not.toContain("function Card(")
  })

  it("Scenario: postMessage bridge implements `sendAction` / `saveState` / `restore` — includes postMessage bridge helpers", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("sendAction")
    expect(html).toContain("saveState")
    expect(html).toContain("__onStateRestored")
  })

  it('Scenario: Mount uses `exportedName` if known, falls back to `App`, else shows "No component found" — uses exportedName for component mounting', () => {
    const html = buildArtifactHtml("function Dashboard() {}", { title: "Test", exportedName: "Dashboard" })
    expect(html).toContain("Dashboard")
    expect(html).toContain("No component found")
  })

  it("falls back to App when no exportedName", () => {
    const html = buildArtifactHtml("function App() {}", { title: "Test", exportedName: null })
    expect(html).toContain("App")
  })

  it("Scenario: Theme vars sync from parent on load and on theme change — the parent pushes them in", () => {
    const html = buildArtifactHtml("var x = 1;", { title: "T", fill: false, theme: {
      vars: { foreground: "oklch(0.97 0.01 248)" },
      dark: true,
    } })
    // The direction inverted when artifacts got their own origin: the document
    // used to read `window.parent.getComputedStyle` and watch the parent's root
    // with a MutationObserver, and both are a cross-origin DOM reach that throws
    // a SecurityError — from the head script, before anything else in the
    // document runs. So the parent measures and pushes instead: once into the
    // written document, and again by message when its own theme changes.
    expect(html).not.toContain("window.parent.getComputedStyle")
    expect(html).toContain(":root{--foreground:oklch(0.97 0.01 248)}")
    expect(html).toContain("receiveThemeVars")
    // The mode travels with the values — Tailwind's dark: variant keys on the
    // class, so values alone leave every component that carries one out of step.
    expect(html).toContain(`<html lang="en" class="dark">`)
    // Should NOT have hardcoded fallback values
    expect(html).not.toContain("#0d1117")
    expect(html).not.toContain("#e6edf3")
  })

  it("does not use eval or base64 encoding", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).not.toContain("data-code=")
    expect(html).not.toContain("atob(")
    expect(html).not.toContain("(0, eval)")
  })

  it("Scenario: Wheel events bubble to the parent only when the inner element cannot scroll — forwards wheel only for non-scrollable horizontal targets", () => {
    // WHEN the user scrolls horizontally: if an ancestor has scrollWidth > clientWidth keep it;
    // otherwise forward { type: "wheel", deltaX, deltaY } to the parent and preventDefault().
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("scrollWidth > el.clientWidth")
    expect(html).toContain("type: 'wheel'")
    expect(html).toContain("preventDefault")
  })

  it("Scenario: Errors are forwarded as overlay-able events — posts { type: 'error' } on throw and unhandledrejection", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("unhandledrejection")
    expect(html).toContain("type: 'error'")
  })

  it("Scenario: Height reports after layout settles, with a 2 s fallback — double-rAF report plus setTimeout fallback", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("__reportHeight")
    expect(html).toContain("requestAnimationFrame")
    expect(html).toContain("scrollHeight")
    // 2s fallback so the host never stays in skeleton forever
    expect(html).toContain("2000")
  })

  it("Scenario: Wide tables get a horizontal scroll wrapper — wraps tables in table-scroll-wrap", () => {
    const html = buildArtifactHtml("var x = 1;")
    expect(html).toContain("table-scroll-wrap")
  })

  it("Scenario: Compile or runtime errors render as a destructive in-flow block — transformError renders an error box", () => {
    // WHEN transformError is set the document shows the message in-flow (not a blank iframe).
    const html = buildArtifactHtml(undefined, { title: "Test", transformError: "SyntaxError: boom" })
    expect(html).toContain("error-box")
    expect(html).toContain("SyntaxError: boom")
  })
})
