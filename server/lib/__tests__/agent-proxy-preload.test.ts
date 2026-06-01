import { describe, it, expect, afterEach, beforeEach } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { getGlobalDispatcher, setGlobalDispatcher, ProxyAgent, Agent } from "undici"

const PRELOAD_PATH = resolve(__dirname, "../agent-proxy-preload.mjs")

describe("agent-proxy-preload", () => {
  let original: ReturnType<typeof getGlobalDispatcher>
  let origProxy: string | undefined

  beforeEach(() => {
    original = getGlobalDispatcher()
    origProxy = process.env.HTTPS_PROXY
  })

  afterEach(() => {
    setGlobalDispatcher(original)
    if (origProxy !== undefined) process.env.HTTPS_PROXY = origProxy
    else delete process.env.HTTPS_PROXY
  })

  it("Scenario: Preload is a `.mjs` file, not `.ts` or `.js` — the preload module exists with the .mjs extension", () => {
    expect(PRELOAD_PATH.endsWith(".mjs")).toBe(true)
    expect(existsSync(PRELOAD_PATH)).toBe(true)
    const src = readFileSync(PRELOAD_PATH, "utf8")
    expect(src).toContain("setGlobalDispatcher")
  })

  it("Scenario: Preload is a no-op when `HTTPS_PROXY` is unset — leaves the global dispatcher unchanged", async () => {
    delete process.env.HTTPS_PROXY
    const before = getGlobalDispatcher()
    // Fresh import each run via cache-busting query string
    await import(`${PRELOAD_PATH}?nohttp=${Date.now()}`)
    expect(getGlobalDispatcher()).toBe(before)
  })

  it("Scenario: `undici` global dispatcher is configured from `HTTPS_PROXY` — installs a ProxyAgent when HTTPS_PROXY is set", async () => {
    // Reset to a plain Agent so we can detect the swap to a ProxyAgent
    setGlobalDispatcher(new Agent())
    process.env.HTTPS_PROXY = "http://my-token@127.0.0.1:54321"
    await import(`${PRELOAD_PATH}?withhttp=${Date.now()}`)
    expect(getGlobalDispatcher()).toBeInstanceOf(ProxyAgent)
  })
})
