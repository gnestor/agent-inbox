import { afterEach, describe, expect, it } from "vitest"
import { Hono } from "hono"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mountProductionAssets } from "../production-assets.ts"

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("Inbox production assets", () => {
  it("Scenario: shared artifact modules are served before the SPA fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "inbox-production-assets-"))
    temporaryRoots.push(root)
    const inboxDistPath = join(root, "inbox")
    const artifactDistPath = join(root, "artifact")
    mkdirSync(inboxDistPath)
    mkdirSync(artifactDistPath)
    writeFileSync(join(inboxDistPath, "index.html"), "<main>Inbox</main>")
    writeFileSync(join(artifactDistPath, "react.mjs"), "export const runtime = 'react'")

    const app = new Hono()
    mountProductionAssets(app, { inboxDistPath, artifactDistPath })

    const moduleResponse = await app.request("http://localhost/@hammies/react.mjs")
    expect(moduleResponse.status).toBe(200)
    expect(moduleResponse.headers.get("content-type")).toContain("text/javascript")
    expect(await moduleResponse.text()).toContain("runtime")

    const routeResponse = await app.request("http://localhost/gmail/thread-1")
    expect(routeResponse.status).toBe(200)
    expect(await routeResponse.text()).toContain("Inbox")
  })
})
