import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

// Resolve repo-relative paths from this test file (src/lib/__tests__/)
const pkgRoot = resolve(__dirname, "../../..")
const read = (rel: string) => readFileSync(resolve(pkgRoot, rel), "utf8")

describe("theming static surface", () => {
  it("Scenario: Inbox imports the frontend theme + prose + syntax styles", () => {
    const css = read("src/index.css")
    expect(css).toContain('@import "@hammies/frontend/styles"')
    expect(css).toContain('@import "@hammies/frontend/prose.css"')
    expect(css).toContain('@import "@hammies/frontend/one-syntax.css"')
    expect(css).toContain('@source "../../frontend/src"')
    expect(css).toContain('@plugin "@tailwindcss/typography"')
  })

  it("Scenario: Scrollbars are thin globally", () => {
    const css = read("src/index.css")
    expect(css).toMatch(/\*\s*\{\s*scrollbar-width:\s*thin/)
  })

  it("Scenario: Primary token uses OKLCH and is shared across themes", () => {
    const css = read("src/index.css")
    // --primary is OKLCH with alpha and identical in :root and .dark contexts
    expect(css).toContain("--primary: oklch(0.54 0.27 259.29 / 0.7)")
    // --secondary flips between white/black at low alpha
    expect(css).toContain("--secondary: oklch(1 0 0 / 0.05)")
    expect(css).toContain("--secondary: oklch(0 0 0 / 0.05)")
  })

  it("Scenario: Manifest declares standalone install mode", () => {
    const manifest = JSON.parse(read("public/manifest.json"))
    expect(manifest.display).toBe("standalone")
    expect(manifest.start_url).toBe("/")
    expect(manifest.background_color).toBe("#09090b")
    expect(manifest.theme_color).toBe("#09090b")
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toContain("192x192")
    expect(sizes).toContain("512x512")
    expect(manifest.icons.every((i: { type: string }) => i.type === "image/png")).toBe(true)
  })

  it("Scenario: Service worker registers without caching API responses", () => {
    const sw = read("public/sw.js")
    // install/activate lifecycle to make installable + clean caches
    expect(sw).toContain('addEventListener("install"')
    expect(sw).toContain('addEventListener("activate"')
    // does NOT intercept /api/* — only navigation requests
    expect(sw).not.toContain("/api/")
    expect(sw).toContain('request.mode === "navigate"')
  })

  it("Scenario: Standalone mode respects the status bar inset", () => {
    const css = read("src/index.css")
    expect(css).toMatch(/padding-top:\s*env\(safe-area-inset-top\)/)
  })

  it("Scenario: Integration brand icons live in `src/assets/icons/`", () => {
    const iconsDir = resolve(pkgRoot, "src/assets/icons")
    expect(existsSync(iconsDir)).toBe(true)
    const svgs = readdirSync(iconsDir).filter((f) => f.endsWith(".svg"))
    expect(svgs.length).toBeGreaterThan(0)
    // PWA-only icons live in public/icons (served as-is, not bundled)
    expect(existsSync(resolve(pkgRoot, "public/icons/icon-192.png"))).toBe(true)
    expect(existsSync(resolve(pkgRoot, "public/icons/icon-512.png"))).toBe(true)
  })

  it("Scenario: `__APP_VERSION__` is a defined global", () => {
    const dts = read("src/vite-env.d.ts")
    expect(dts).toContain("declare const __APP_VERSION__: string")
  })
})
