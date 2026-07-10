import { describe, it, expect, afterEach } from "vitest"
import { Hono } from "hono"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pluginAssetRoutes, inboxPluginAssetUrl } from "../plugin-assets.js"

// Mount under /api exactly as server/index.ts does, so the URL that
// inboxPluginAssetUrl produces (which includes the /api prefix) is exercised.
function mount(dirs: Map<string, string>): Hono {
  const app = new Hono()
  app.route("/api", pluginAssetRoutes(dirs) as unknown as Hono)
  return app
}

describe("plugin-assets route", () => {
  let root: string
  afterEach(() => root && rmSync(root, { recursive: true, force: true }))

  function fixture(): string {
    root = mkdtempSync(join(tmpdir(), "inbox-plugin-assets-"))
    mkdirSync(join(root, "icons"))
    writeFileSync(join(root, "icons", "microsoft.svg"), "<svg>ms</svg>")
    return root
  }

  it("Scenario: A plugin-declared integration's brand icon renders in inbox — serves the icon from the plugin dir", async () => {
    const dir = fixture()
    const app = mount(new Map([["microsoft-ads", dir]]))

    const res = await app.request(inboxPluginAssetUrl("microsoft-ads", "icons/microsoft.svg"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/svg+xml")
    expect(await res.text()).toBe("<svg>ms</svg>")
  })

  it("returns 404 for an unknown plugin id", async () => {
    const app = mount(new Map())
    const res = await app.request("/api/plugin-assets/nope/icons/x.svg")
    expect(res.status).toBe(404)
  })

  it("returns 404 for a traversal outside the plugin dir", async () => {
    const dir = fixture()
    const app = mount(new Map([["microsoft-ads", dir]]))
    const res = await app.request("/api/plugin-assets/microsoft-ads/..%2f..%2fetc%2fpasswd.svg")
    expect(res.status).toBe(404)
  })

  it("inboxPluginAssetUrl strips a leading ./ or / from the asset path", () => {
    expect(inboxPluginAssetUrl("p", "./icons/a.svg")).toBe("/api/plugin-assets/p/icons/a.svg")
    expect(inboxPluginAssetUrl("p", "/icons/a.svg")).toBe("/api/plugin-assets/p/icons/a.svg")
  })
})
