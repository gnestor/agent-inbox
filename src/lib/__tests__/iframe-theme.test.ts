import { describe, it, expect } from "vitest"
import { injectIntoHtml, THEME_VARS, IFRAME_BASE_CSS } from "../iframe-theme"
import { queryClient } from "../queryClient"

const STYLE = "<style>:root{--background:#fff}</style>"
const SCRIPT = "<script>window.ready=1</script>"

describe("iframe-theme injectIntoHtml", () => {
  it("Scenario: `injectIntoHtml(html, themeStyle, trailingScript)` patches HTML before iframe display", () => {
    // full document with <head> + <body>: style before </head>, script before </body>
    const full = "<html><head><title>t</title></head><body><p>hi</p></body></html>"
    const out = injectIntoHtml(full, STYLE, SCRIPT)
    expect(out).toContain(STYLE + "</head>")
    expect(out).toContain(SCRIPT + "</body>")

    // no <head> but a <body>: both payloads inserted before </body>
    const noHead = "<body><p>hi</p></body>"
    const out2 = injectIntoHtml(noHead, STYLE, SCRIPT)
    expect(out2).toContain(STYLE + SCRIPT + "</body>")

    // only </html>: payload before </html>
    const onlyHtml = "<html><p>hi</p></html>"
    expect(injectIntoHtml(onlyHtml, STYLE, SCRIPT)).toContain(STYLE + SCRIPT + "</html>")

    // bare fragment: payload appended
    const frag = "<p>hi</p>"
    expect(injectIntoHtml(frag, STYLE, SCRIPT)).toBe(frag + STYLE + SCRIPT)

    // the forwarded variables come from THEME_VARS, base CSS from IFRAME_BASE_CSS
    expect(THEME_VARS).toContain("background")
    expect(THEME_VARS).toContain("foreground")
    expect(IFRAME_BASE_CSS).toContain("var(--foreground)")
  })
})

describe("queryClient", () => {
  it("Scenario: `queryClient` defaults are 5 min stale, 24 h gc, 1 retry, no focus refetch", () => {
    const q = queryClient.getDefaultOptions().queries
    expect(q?.staleTime).toBe(5 * 60 * 1000)
    // gcTime MUST be >= the persister maxAge (24h)
    expect(q?.gcTime).toBe(24 * 60 * 60 * 1000)
    expect(q?.retry).toBe(1)
    expect(q?.refetchOnWindowFocus).toBe(false)
  })
})
