import { describe, it, expect } from "vitest"
import { buildPluginComponentHtml } from "../build-plugin-component-html.js"

describe("buildPluginComponentHtml", () => {
  const origin = "https://example.test"

  it("Scenario: Plugin component HTML is built with importmap + null-origin srcDoc — CSP, importmap, module script, and bridge are present", () => {
    const html = buildPluginComponentHtml("gmail", "EmailThread", { id: "t1" }, origin)

    // CSP declares the exact source allowlist.
    expect(html).toContain(
      `default-src 'none'; script-src 'unsafe-inline' ${origin}; style-src 'unsafe-inline' ${origin}; connect-src 'self'; img-src * data: blob:; font-src *;`,
    )
    // Importmap maps framework + shared UI to the parent's prebuilt modules.
    expect(html).toContain(`"react": "${origin}/@hammies/react.mjs"`)
    expect(html).toContain(`"react-dom": "${origin}/@hammies/react-dom.mjs"`)
    expect(html).toContain(`"@hammies/frontend/components/ui": "${origin}/@hammies/artifact.mjs"`)
    expect(html).toContain(`"@hammies/frontend/lib/utils": "${origin}/@hammies/artifact.mjs"`)
    // The component is loaded as a module from the plugin component endpoint.
    expect(html).toContain(`${origin}/api/gmail/components/EmailThread`)
    // postMessage bridge surface.
    for (const fn of ["navigate", "selectItem", "pushPanel", "getPluginId", "sendAction", "saveState", "__onStateRestored"]) {
      expect(html).toContain(fn)
    }
  })

  it("escapes `<` in JSON-encoded props to prevent script-tag breakouts", () => {
    const html = buildPluginComponentHtml("gmail", "EmailThread", { body: "</script><x>" }, origin)
    // Raw `<` from props must not appear unescaped; it is encoded as <.
    expect(html).toContain("\\u003c/script")
    expect(html).not.toContain("</script><x>")
  })
})
