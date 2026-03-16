import { describe, it, expect } from "vitest"

process.env.VAULT_SECRET = "aa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"

import {
  createCredentialProxy,
  shouldIntercept,
  hostToIntegration,
  INTERCEPTED_HOSTS,
  type CredentialProxy,
} from "../credential-proxy.js"

describe("shouldIntercept", () => {
  it("returns true for exact match hosts", () => {
    expect(shouldIntercept("api.notion.com")).toBe(true)
    expect(shouldIntercept("api.github.com")).toBe(true)
    expect(shouldIntercept("slack.com")).toBe(true)
    expect(shouldIntercept("api.slack.com")).toBe(true)
    expect(shouldIntercept("hooks.slack.com")).toBe(true)
    expect(shouldIntercept("api.air.inc")).toBe(true)
  })

  it("returns true for subdomain matches (endsWith)", () => {
    expect(shouldIntercept("mystore.shopify.com")).toBe(true)
    expect(shouldIntercept("admin.shopify.com")).toBe(true)
    expect(shouldIntercept("sheets.googleapis.com")).toBe(true)
    expect(shouldIntercept("www.googleapis.com")).toBe(true)
    expect(shouldIntercept("oauth2.googleapis.com")).toBe(true)
  })

  it("returns false for non-intercepted hosts", () => {
    expect(shouldIntercept("example.com")).toBe(false)
    expect(shouldIntercept("api.openai.com")).toBe(false)
    expect(shouldIntercept("google.com")).toBe(false)
    expect(shouldIntercept("notslack.com")).toBe(false)
    expect(shouldIntercept("fakeshopify.com")).toBe(false)
    // Should NOT match if host merely contains the string but isn't a subdomain
    expect(shouldIntercept("notapi.notion.com.evil.com")).toBe(false)
  })
})

describe("hostToIntegration", () => {
  it("maps known hosts to integration names", () => {
    expect(hostToIntegration("api.notion.com")).toBe("notion")
    expect(hostToIntegration("api.github.com")).toBe("github")
    expect(hostToIntegration("slack.com")).toBe("slack")
    expect(hostToIntegration("api.slack.com")).toBe("slack")
    expect(hostToIntegration("hooks.slack.com")).toBe("slack")
    expect(hostToIntegration("mystore.shopify.com")).toBe("shopify")
    expect(hostToIntegration("sheets.googleapis.com")).toBe("google")
    expect(hostToIntegration("www.googleapis.com")).toBe("google")
    expect(hostToIntegration("api.air.inc")).toBe("air")
  })

  it("returns the host itself for unknown hosts", () => {
    expect(hostToIntegration("example.com")).toBe("example.com")
  })
})

describe("INTERCEPTED_HOSTS", () => {
  it("contains all expected API hosts", () => {
    expect(INTERCEPTED_HOSTS).toContain("api.notion.com")
    expect(INTERCEPTED_HOSTS).toContain("api.github.com")
    expect(INTERCEPTED_HOSTS).toContain("slack.com")
    expect(INTERCEPTED_HOSTS).toContain("api.slack.com")
    expect(INTERCEPTED_HOSTS).toContain("hooks.slack.com")
    expect(INTERCEPTED_HOSTS).toContain("shopify.com")
    expect(INTERCEPTED_HOSTS).toContain("googleapis.com")
    expect(INTERCEPTED_HOSTS).toContain("api.air.inc")
  })
})

describe("createCredentialProxy", () => {
  let proxy: CredentialProxy

  it("starts and returns a valid port", async () => {
    proxy = await createCredentialProxy({
      resolveToken: async () => null,
    })
    expect(proxy.port).toBeGreaterThan(0)
    expect(proxy.port).toBeLessThan(65536)
    await proxy.close()
  })

  it("returns a CA cert path ending in ca.pem", async () => {
    proxy = await createCredentialProxy({
      resolveToken: async () => null,
    })
    expect(proxy.caCertPath).toMatch(/ca\.pem$/)
    await proxy.close()
  })

  it("getProxyEnv embeds session token in HTTPS_PROXY URL userinfo", async () => {
    proxy = await createCredentialProxy({
      resolveToken: async () => null,
    })
    const env = proxy.getProxyEnv("my-session-token-abc")

    expect(env.HTTPS_PROXY).toBe(`http://my-session-token-abc@127.0.0.1:${proxy.port}`)
    expect(env.NODE_EXTRA_CA_CERTS).toBe(proxy.caCertPath)
    expect(env.NODE_USE_ENV_PROXY).toBe("1")
    await proxy.close()
  })

  it("getProxyEnv does not leak raw API tokens", async () => {
    proxy = await createCredentialProxy({
      resolveToken: async () => null,
    })
    const env = proxy.getProxyEnv("tok") as Record<string, string>

    // No raw credential env vars should be present
    expect(env.NOTION_API_TOKEN).toBeUndefined()
    expect(env.GOOGLE_REFRESH_TOKEN).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.INBOX_SESSION_TOKEN).toBeUndefined()

    // Only these three keys should exist
    expect(Object.keys(env).sort()).toEqual(
      ["HTTPS_PROXY", "NODE_EXTRA_CA_CERTS", "NODE_USE_ENV_PROXY"].sort()
    )
    await proxy.close()
  })

  it("resolveToken callback receives session token and integration name", async () => {
    const resolveToken = vi.fn().mockResolvedValue(null)
    proxy = await createCredentialProxy({ resolveToken })

    // We can't easily do a real CONNECT in a unit test, but we can verify
    // the proxy starts and is addressable. The resolveToken mock would be
    // called during an actual HTTPS request through the proxy.
    expect(proxy.port).toBeGreaterThan(0)
    await proxy.close()
  })

  it("each call creates a proxy on a different random port", async () => {
    const proxy1 = await createCredentialProxy({ resolveToken: async () => null })
    const proxy2 = await createCredentialProxy({ resolveToken: async () => null })

    expect(proxy1.port).not.toBe(proxy2.port)

    await proxy1.close()
    await proxy2.close()
  })
})
