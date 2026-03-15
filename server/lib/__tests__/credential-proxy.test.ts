import { describe, it, expect } from "vitest"

// Vault secret for tests
process.env.VAULT_SECRET = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"

import { createCredentialProxy, INTERCEPTED_HOSTS, type CredentialProxy } from "../credential-proxy.js"

describe("credential-proxy", () => {
  let proxy: CredentialProxy

  it("INTERCEPTED_HOSTS includes expected API hosts", () => {
    expect(INTERCEPTED_HOSTS).toContain("api.notion.com")
    expect(INTERCEPTED_HOSTS).toContain("api.github.com")
    expect(INTERCEPTED_HOSTS).toContain("slack.com")
  })

  it("creates a proxy and returns port + CA cert path", async () => {
    proxy = await createCredentialProxy({
      resolveToken: async (_sessionToken, _host) => null,
    })
    expect(proxy.port).toBeGreaterThan(0)
    expect(proxy.caCertPath).toContain("ca.pem")
    await proxy.close()
  })

  it("getProxyEnv returns the expected env vars", async () => {
    proxy = await createCredentialProxy({
      resolveToken: async () => null,
    })
    const env = proxy.getProxyEnv("test-session-token")
    expect(env.HTTPS_PROXY).toBe(`http://test-session-token@127.0.0.1:${proxy.port}`)
    expect(env.NODE_EXTRA_CA_CERTS).toBe(proxy.caCertPath)
    expect(env.NODE_USE_ENV_PROXY).toBe("1")
    // Session token is embedded in proxy URL userinfo, not a separate env var
    expect((env as Record<string, string>).INBOX_SESSION_TOKEN).toBeUndefined()
    // Should NOT contain raw tokens
    expect((env as Record<string, string>).NOTION_API_TOKEN).toBeUndefined()
    expect((env as Record<string, string>).GOOGLE_REFRESH_TOKEN).toBeUndefined()
    await proxy.close()
  })
})
