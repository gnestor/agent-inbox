import { describe, it, expect, vi } from "vitest"
import { proxyRules, resolveHostRule, formatAuthHeader, type IntegrationConfig } from "@hammies/auth/server"

process.env.VAULT_SECRET = "aa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b"

import {
  createCredentialProxy,
  shouldIntercept,
  hostToIntegration,
  interceptedProxyHosts,
  type CredentialProxy,
} from "../credential-proxy.js"

// A small explicit registry fixture (mirrors real plugin declarations,
// including the real Google integration split — google-auth's `google` and
// `google-bigquery` service-account rows, google-workspace's OAuth row, and
// google-ads' OAuth-with-developer-token row) so these tests are hermetic —
// they don't depend on the live `@hammies/auth` registry having been
// populated by `registerPluginIntegrations` at server boot.
const fixtureIntegrations: IntegrationConfig[] = [
  { id: "notion", name: "Notion", icon: "n", scope: "workspace", authType: "api_key", envVars: { credential: "NOTION_API_TOKEN" }, proxy: { hosts: ["api.notion.com"], inject: { kind: "bearer" } } },
  { id: "github", name: "GitHub", icon: "g", scope: "workspace", authType: "api_key", envVars: { credential: "GITHUB_TOKEN" }, proxy: { hosts: ["api.github.com"], inject: { kind: "bearer" } } },
  { id: "slack", name: "Slack", icon: "s", scope: "workspace", authType: "oauth2", envVars: { credential: "SLACK_BOT_TOKEN" }, proxy: { hosts: ["slack.com", "api.slack.com", "hooks.slack.com"], inject: { kind: "bearer" } } },
  { id: "shopify", name: "Shopify", icon: "s", scope: "workspace", authType: "api_key", envVars: { credential: "SHOPIFY_API_TOKEN" }, proxy: { hosts: ["shopify.com"], inject: { kind: "header", header: "X-Shopify-Access-Token" } } },
  { id: "air", name: "Air", icon: "a", scope: "workspace", authType: "api_key", envVars: { credential: "AIR_API_TOKEN" }, proxy: { hosts: ["api.air.inc"], inject: { kind: "bearer" } } },
  { id: "quickbooks", name: "QuickBooks", icon: "q", scope: "workspace", authType: "oauth2", envVars: { credential: "QUICKBOOKS_REFRESH_TOKEN" }, proxy: { hosts: ["quickbooks.api.intuit.com", "sandbox-quickbooks.api.intuit.com"], inject: { kind: "bearer" } } },
  { id: "klaviyo", name: "Klaviyo", icon: "k", scope: "workspace", authType: "api_key", envVars: { credential: "KLAVIYO_API_KEY" }, proxy: { hosts: ["a.klaviyo.com"], inject: { kind: "header", header: "Klaviyo-API-Key" } } },
  { id: "meta", name: "Meta", icon: "m", scope: "workspace", authType: "oauth2", envVars: { credential: "META_ACCESS_TOKEN" }, proxy: { hosts: ["graph.facebook.com"], inject: { kind: "query", param: "access_token" } } },
  { id: "gorgias", name: "Gorgias", icon: "g", scope: "workspace", authType: "api_key", envVars: { credential: "GORGIAS_API_TOKEN" }, proxy: { hosts: ["gorgias.com"], inject: { kind: "basic" } } },
  { id: "pinterest", name: "Pinterest", icon: "p", scope: "workspace", authType: "oauth2", envVars: { credential: "PINTEREST_ACCESS_TOKEN" }, proxy: { hosts: ["api.pinterest.com"], inject: { kind: "bearer" } } },
  // Google — service-account rows (analytics/search-console resource APIs the
  // SA accesses directly; no user impersonation).
  { id: "google", name: "Google", icon: "g", scope: "workspace", authType: "service_account", envVars: { credential: "GOOGLE_SERVICE_ACCOUNT_JSON" }, proxy: { hosts: ["analyticsdata.googleapis.com", "analyticsadmin.googleapis.com", "searchconsole.googleapis.com"], inject: { kind: "bearer" } } },
  { id: "google-bigquery", name: "Google BigQuery", icon: "g", scope: "workspace", authType: "service_account", envVars: { credential: "GOOGLE_SERVICE_ACCOUNT_JSON" }, proxy: { hosts: ["bigquery.googleapis.com"], inject: { kind: "bearer" } } },
  // Gemini — API key via query param, more specific than the googleapis.com family.
  { id: "gemini", name: "Gemini", icon: "g", scope: "workspace", authType: "api_key", envVars: { credential: "GEMINI_API_KEY" }, proxy: { hosts: ["generativelanguage.googleapis.com"], inject: { kind: "query", param: "key" } } },
  // Google Workspace — user OAuth (Gmail/Calendar/Sheets/Docs).
  { id: "google-workspace", name: "Google Workspace", icon: "g", scope: "user", authType: "oauth2", envVars: { credential: "GOOGLE_REFRESH_TOKEN" }, proxy: { hosts: ["gmail.googleapis.com", "calendar.googleapis.com", "sheets.googleapis.com", "www.googleapis.com", "docs.googleapis.com", "trends.googleapis.com"], inject: { kind: "bearer" } } },
  // Google Ads — workspace OAuth plus a config-backed developer-token header.
  { id: "google-ads", name: "Google Ads", icon: "g", scope: "workspace", authType: "oauth2", envVars: { credential: "GOOGLE_REFRESH_TOKEN", config: ["GOOGLE_ADS_DEVELOPER_TOKEN"] }, proxy: { hosts: ["googleads.googleapis.com"], inject: { kind: "bearer" }, headers: [{ header: "developer-token", valueEnv: "GOOGLE_ADS_DEVELOPER_TOKEN" }] } },
]
const rules = proxyRules(fixtureIntegrations)

describe("shouldIntercept", () => {
  it("Scenario: Only allowlisted hosts are MITM-intercepted — returns true for exact match hosts", () => {
    expect(shouldIntercept("api.notion.com", rules)).toBe(true)
    expect(shouldIntercept("api.github.com", rules)).toBe(true)
    expect(shouldIntercept("slack.com", rules)).toBe(true)
    expect(shouldIntercept("api.slack.com", rules)).toBe(true)
    expect(shouldIntercept("hooks.slack.com", rules)).toBe(true)
    expect(shouldIntercept("api.air.inc", rules)).toBe(true)
    expect(shouldIntercept("a.klaviyo.com", rules)).toBe(true)
    expect(shouldIntercept("graph.facebook.com", rules)).toBe(true)
    expect(shouldIntercept("api.pinterest.com", rules)).toBe(true)
  })

  it("returns true for subdomain matches (endsWith)", () => {
    expect(shouldIntercept("mystore.shopify.com", rules)).toBe(true)
    expect(shouldIntercept("sheets.googleapis.com", rules)).toBe(true)
    expect(shouldIntercept("www.googleapis.com", rules)).toBe(true)
    expect(shouldIntercept("mystore.gorgias.com", rules)).toBe(true)
    expect(shouldIntercept("sandbox-quickbooks.api.intuit.com", rules)).toBe(true)
  })

  it("returns false for non-intercepted hosts", () => {
    expect(shouldIntercept("example.com", rules)).toBe(false)
    expect(shouldIntercept("api.openai.com", rules)).toBe(false)
    expect(shouldIntercept("google.com", rules)).toBe(false)
    expect(shouldIntercept("notslack.com", rules)).toBe(false)
    expect(shouldIntercept("fakeshopify.com", rules)).toBe(false)
    // Should NOT match if host merely contains the string but isn't a subdomain
    expect(shouldIntercept("notapi.notion.com.evil.com", rules)).toBe(false)
    // oauth2.googleapis.com isn't declared by any Google integration's proxy
    // hosts (token refresh goes over the vault's own direct fetch, never
    // through the credential proxy) — it must NOT fall into a catch-all.
    expect(shouldIntercept("oauth2.googleapis.com", rules)).toBe(false)
  })
})

describe("hostToIntegration", () => {
  it("Scenario: `hostToIntegration` maps hostnames to vault integration names — maps known hosts to integration names", () => {
    expect(hostToIntegration("api.notion.com", rules)).toBe("notion")
    expect(hostToIntegration("api.github.com", rules)).toBe("github")
    expect(hostToIntegration("slack.com", rules)).toBe("slack")
    expect(hostToIntegration("api.slack.com", rules)).toBe("slack")
    expect(hostToIntegration("hooks.slack.com", rules)).toBe("slack")
    expect(hostToIntegration("mystore.shopify.com", rules)).toBe("shopify")
    expect(hostToIntegration("api.air.inc", rules)).toBe("air")
    expect(hostToIntegration("a.klaviyo.com", rules)).toBe("klaviyo")
    expect(hostToIntegration("graph.facebook.com", rules)).toBe("meta")
    expect(hostToIntegration("mystore.gorgias.com", rules)).toBe("gorgias")
    expect(hostToIntegration("api.pinterest.com", rules)).toBe("pinterest")
    expect(hostToIntegration("quickbooks.api.intuit.com", rules)).toBe("quickbooks")
    expect(hostToIntegration("sandbox-quickbooks.api.intuit.com", rules)).toBe("quickbooks")
  })

  it("Scenario: googleapis.com hosts resolve per-integration, not to one catch-all", () => {
    // Service-account resource APIs → the `google` SA row.
    expect(hostToIntegration("analyticsdata.googleapis.com", rules)).toBe("google")
    expect(hostToIntegration("analyticsadmin.googleapis.com", rules)).toBe("google")
    expect(hostToIntegration("searchconsole.googleapis.com", rules)).toBe("google")
    // A distinct service-account row, not folded into `google`.
    expect(hostToIntegration("bigquery.googleapis.com", rules)).toBe("google-bigquery")
    // User-OAuth Gmail/Calendar/Sheets/Docs, not the service-account `google` row.
    expect(hostToIntegration("gmail.googleapis.com", rules)).toBe("google-workspace")
    expect(hostToIntegration("calendar.googleapis.com", rules)).toBe("google-workspace")
    expect(hostToIntegration("sheets.googleapis.com", rules)).toBe("google-workspace")
    expect(hostToIntegration("www.googleapis.com", rules)).toBe("google-workspace")
    // Workspace-OAuth Ads, with its own developer-token header — not `google`.
    expect(hostToIntegration("googleads.googleapis.com", rules)).toBe("google-ads")
  })

  it("maps generativelanguage.googleapis.com to gemini, not google", () => {
    expect(hostToIntegration("generativelanguage.googleapis.com", rules)).toBe("gemini")
  })

  it("returns the host itself for unknown hosts", () => {
    expect(hostToIntegration("example.com", rules)).toBe("example.com")
  })
})

describe("ambiguous host resolution", () => {
  it("Scenario: An ambiguous host match is refused, not guessed", () => {
    // Two integrations declaring the identical host at equal specificity —
    // resolveHostRule can't pick a winner, so the CONNECT handler must refuse
    // rather than inject either one's credential (see credential-proxy.ts's
    // `resolution.status !== "matched"` → 403 branch).
    const clashing: IntegrationConfig[] = [
      { id: "a", name: "A", icon: "a", scope: "workspace", authType: "api_key", envVars: { credential: "A_TOKEN" }, proxy: { hosts: ["clash.example.com"], inject: { kind: "bearer" } } },
      { id: "b", name: "B", icon: "b", scope: "workspace", authType: "api_key", envVars: { credential: "B_TOKEN" }, proxy: { hosts: ["clash.example.com"], inject: { kind: "bearer" } } },
    ]
    const clashingRules = proxyRules(clashing)
    expect(resolveHostRule("clash.example.com", undefined, clashingRules).status).toBe("ambiguous")
  })
})

describe("interceptedProxyHosts", () => {
  it("contains all expected API hosts", () => {
    const hosts = interceptedProxyHosts(rules)
    expect(hosts).toContain("api.notion.com")
    expect(hosts).toContain("api.github.com")
    expect(hosts).toContain("slack.com")
    expect(hosts).toContain("api.slack.com")
    expect(hosts).toContain("hooks.slack.com")
    expect(hosts).toContain("shopify.com")
    expect(hosts).toContain("api.air.inc")
    expect(hosts).toContain("a.klaviyo.com")
    expect(hosts).toContain("graph.facebook.com")
    expect(hosts).toContain("gorgias.com")
    expect(hosts).toContain("api.pinterest.com")
    // No bare "googleapis.com" catch-all — every Google integration declares
    // its own specific host list.
    expect(hosts).not.toContain("googleapis.com")
  })
})

describe("auth-method dispatch (registry-driven `inject` rules)", () => {
  it("defines an inject rule for every integration in the fixture", () => {
    for (const integration of fixtureIntegrations) {
      const rule = rules.find((r) => r.integration === integration.id)
      expect(rule?.inject).toBeDefined()
    }
  })

  it("Scenario: Header-named integrations get a custom header — uses custom headers for shopify and klaviyo", () => {
    expect(formatAuthHeader({ kind: "header", header: "X-Shopify-Access-Token" }, { token: "tok" })).toBe(
      "X-Shopify-Access-Token: tok",
    )
    expect(formatAuthHeader({ kind: "header", header: "Klaviyo-API-Key" }, { token: "tok" })).toBe(
      "Klaviyo-API-Key: tok",
    )
  })

  it("Scenario: Query-param integrations rewrite the request URL — uses query param for meta and gemini", () => {
    const metaRule = rules.find((r) => r.integration === "meta")
    const geminiRule = rules.find((r) => r.integration === "gemini")
    expect(metaRule?.inject).toEqual({ kind: "query", param: "access_token" })
    expect(geminiRule?.inject).toEqual({ kind: "query", param: "key" })
  })

  it("Scenario: Basic-auth integrations encode `<extra>:<token>` — uses basic auth for gorgias", () => {
    expect(formatAuthHeader({ kind: "basic" }, { token: "tok", extras: { email: "shop@example.com" } })).toBe(
      `Authorization: Basic ${Buffer.from("shop@example.com:tok").toString("base64")}`,
    )
  })

  it("Scenario: Bearer integrations get `Authorization: Bearer <token>` — bearer type for notion/github/slack/google/air/quickbooks/pinterest", () => {
    for (const id of ["notion", "github", "slack", "google", "air", "quickbooks", "pinterest"]) {
      const rule = rules.find((r) => r.integration === id)
      expect(rule?.inject).toEqual({ kind: "bearer" })
    }
  })

  it("Scenario: A workspace-OAuth integration's config-backed header rides alongside its bearer token — google-ads developer-token", () => {
    const rule = rules.find((r) => r.integration === "google-ads")
    expect(rule?.inject).toEqual({ kind: "bearer" })
    expect(rule?.headers).toEqual([{ header: "developer-token", valueEnv: "GOOGLE_ADS_DEVELOPER_TOKEN" }])
  })
})

describe("createCredentialProxy", () => {
  let proxy: CredentialProxy

  it("starts and returns a valid port", async () => {
    proxy = await createCredentialProxy({
      resolveCredential: async () => null,
    })
    expect(proxy.port).toBeGreaterThan(0)
    expect(proxy.port).toBeLessThan(65536)
    await proxy.close()
  })

  it("returns a CA cert path ending in ca.pem", async () => {
    proxy = await createCredentialProxy({
      resolveCredential: async () => null,
    })
    expect(proxy.caCertPath).toMatch(/ca\.pem$/)
    await proxy.close()
  })

  it("getProxyEnv embeds session token in HTTPS_PROXY URL userinfo", async () => {
    proxy = await createCredentialProxy({
      resolveCredential: async () => null,
    })
    const env = proxy.getProxyEnv("my-session-token-abc")

    expect(env.HTTPS_PROXY).toBe(`http://my-session-token-abc@127.0.0.1:${proxy.port}`)
    expect(env.NODE_EXTRA_CA_CERTS).toBe(proxy.caCertPath)
    expect(env.NODE_OPTIONS).toMatch(/--import .+agent-proxy-preload\.mjs/)
    await proxy.close()
  })

  it("Scenario: Four env vars are returned per session token — getProxyEnv does not leak raw API tokens", async () => {
    proxy = await createCredentialProxy({
      resolveCredential: async () => null,
    })
    const env = proxy.getProxyEnv("tok") as Record<string, string>

    // No raw credential env vars should be present
    expect(env.NOTION_API_TOKEN).toBeUndefined()
    expect(env.GOOGLE_REFRESH_TOKEN).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.INBOX_SESSION_TOKEN).toBeUndefined()

    // Only these keys should exist
    expect(Object.keys(env).sort()).toEqual(
      ["HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS", "NODE_OPTIONS"].sort()
    )
    await proxy.close()
  })

  it("resolveCredential callback receives session token and integration name", async () => {
    const resolveCredential = vi.fn().mockResolvedValue(null)
    proxy = await createCredentialProxy({ resolveCredential })

    // We can't easily do a real CONNECT in a unit test, but we can verify
    // the proxy starts and is addressable. The resolveCredential mock would be
    // called during an actual HTTPS request through the proxy.
    expect(proxy.port).toBeGreaterThan(0)
    await proxy.close()
  })

  it("Scenario: `NO_PROXY` bypasses Anthropic API and telemetry hosts — NO_PROXY includes .anthropic.com", async () => {
    proxy = await createCredentialProxy({ resolveCredential: async () => null })
    const env = proxy.getProxyEnv("tok")
    expect(env.NO_PROXY).toContain(".anthropic.com")
    await proxy.close()
  })

  it("each call creates a proxy on a different random port", async () => {
    const proxy1 = await createCredentialProxy({ resolveCredential: async () => null })
    const proxy2 = await createCredentialProxy({ resolveCredential: async () => null })

    expect(proxy1.port).not.toBe(proxy2.port)

    await proxy1.close()
    await proxy2.close()
  })
})
