import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { resetIntegrationRegistry } from "@hammies/auth/server"
import { discoverWorkspacePluginIntegrations, registerPluginIntegrations, getIntegration } from "../integrations.js"

describe("inbox plugin integration aggregation", () => {
  let root = ""
  afterEach(() => {
    resetIntegrationRegistry()
    if (root) rmSync(root, { recursive: true, force: true })
    root = ""
  })

  it("Scenario: Inbox registers workspace plugins' declared integrations at startup", () => {
    root = mkdtempSync(join(tmpdir(), "inbox-plugin-agg-"))
    const dir = join(root, "plugins", "acme")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "acme",
        studio: {
          integrations: [
            { id: "acme", name: "Acme", scope: "workspace", authType: "api_key", env: { credential: "ACME_KEY" } },
          ],
        },
      }),
    )

    // A plugin-only integration is invisible until inbox aggregates at boot...
    expect(getIntegration("acme")).toBeUndefined()
    // ...the boot path: discover the workspace's plugin manifests → register into the shared registry.
    registerPluginIntegrations(discoverWorkspacePluginIntegrations([root]))
    expect(getIntegration("acme")?.sourcePlugin).toBe("acme")
  })
})
