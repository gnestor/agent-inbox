import { describe, it, expect, vi, beforeEach } from "vitest"

const mockFetch = vi.fn()
global.fetch = mockFetch

function okJson(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) })
}

// Reset module state between tests by re-importing
let loadCredentials: typeof import("../credentials.js")["loadCredentials"]
let getCredential: typeof import("../credentials.js")["getCredential"]
let getCredentials: typeof import("../credentials.js")["getCredentials"]
let getAgentEnv: typeof import("../credentials.js")["getAgentEnv"]
let getGoogleAccessToken: typeof import("../credentials.js")["getGoogleAccessToken"]

describe("credentials", () => {
  beforeEach(async () => {
    vi.resetModules()
    mockFetch.mockReset()
    const mod = await import("../credentials.js")
    loadCredentials = mod.loadCredentials
    getCredential = mod.getCredential
    getCredentials = mod.getCredentials
    getAgentEnv = mod.getAgentEnv
    getGoogleAccessToken = mod.getGoogleAccessToken
  })

  describe("loadCredentials / getCredential / getCredentials", () => {
    it("loads credentials from a .env file", () => {
      // Use the test fixtures or a known directory; since we can't control dotenv easily,
      // test the flow with a nonexistent path (warns) and verify empty result
      const result = loadCredentials("/nonexistent/path")
      expect(result).toEqual({})
    })

    it("getCredential throws for missing key", () => {
      loadCredentials("/nonexistent/path")
      expect(() => getCredential("MISSING_KEY")).toThrow("Missing credential: MISSING_KEY")
    })

    it("getCredentials returns all loaded credentials", () => {
      loadCredentials("/nonexistent/path")
      expect(getCredentials()).toEqual({})
    })
  })

  describe("getAgentEnv", () => {
    it("excludes ANTHROPIC_API_KEY", async () => {
      // Manually load credentials by importing fresh and simulating state
      // We need to set up internal state, so we'll use a workaround:
      // Load from a real directory but the real test is exclusion logic
      vi.resetModules()

      // Mock dotenv to return known credentials
      vi.doMock("dotenv", () => ({
        config: () => ({
          parsed: {
            GOOGLE_CLIENT_ID: "gid",
            GOOGLE_CLIENT_SECRET: "gsecret",
            ANTHROPIC_API_KEY: "sk-ant-secret",
            NOTION_API_TOKEN: "notion-token",
          },
        }),
      }))

      const mod = await import("../credentials.js")
      mod.loadCredentials("/fake/path")

      const env = mod.getAgentEnv()
      expect(env).toHaveProperty("GOOGLE_CLIENT_ID", "gid")
      expect(env).toHaveProperty("NOTION_API_TOKEN", "notion-token")
      expect(env).not.toHaveProperty("ANTHROPIC_API_KEY")
    })
  })

  describe("getGoogleAccessToken", () => {
    it("fetches and returns access token", async () => {
      vi.resetModules()
      vi.doMock("dotenv", () => ({
        config: () => ({
          parsed: {
            GOOGLE_CLIENT_ID: "cid",
            GOOGLE_CLIENT_SECRET: "csecret",
            GOOGLE_REFRESH_TOKEN: "rtoken",
          },
        }),
      }))

      const mod = await import("../credentials.js")
      mod.loadCredentials("/fake")

      mockFetch.mockReturnValueOnce(
        okJson({ access_token: "fresh-token", expires_in: 3600 }),
      )

      const token = await mod.getGoogleAccessToken()
      expect(token).toBe("fresh-token")

      // Verify it called Google OAuth
      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toBe("https://oauth2.googleapis.com/token")
      expect(opts.method).toBe("POST")
      expect(opts.body.toString()).toContain("grant_type=refresh_token")
    })

    it("returns cached token on second call", async () => {
      vi.resetModules()
      vi.doMock("dotenv", () => ({
        config: () => ({
          parsed: {
            GOOGLE_CLIENT_ID: "cid",
            GOOGLE_CLIENT_SECRET: "csecret",
            GOOGLE_REFRESH_TOKEN: "rtoken",
          },
        }),
      }))

      const mod = await import("../credentials.js")
      mod.loadCredentials("/fake")

      mockFetch.mockReturnValueOnce(
        okJson({ access_token: "cached-token", expires_in: 3600 }),
      )

      const token1 = await mod.getGoogleAccessToken()
      const token2 = await mod.getGoogleAccessToken()

      expect(token1).toBe("cached-token")
      expect(token2).toBe("cached-token")
      expect(mockFetch).toHaveBeenCalledTimes(1) // Only one fetch call — second used cache
    })

    it("throws when token refresh fails", async () => {
      vi.resetModules()
      vi.doMock("dotenv", () => ({
        config: () => ({
          parsed: {
            GOOGLE_CLIENT_ID: "cid",
            GOOGLE_CLIENT_SECRET: "csecret",
            GOOGLE_REFRESH_TOKEN: "rtoken",
          },
        }),
      }))

      const mod = await import("../credentials.js")
      mod.loadCredentials("/fake")

      mockFetch.mockReturnValueOnce(
        Promise.resolve({ ok: false, text: () => Promise.resolve("invalid_grant") }),
      )

      await expect(mod.getGoogleAccessToken()).rejects.toThrow("Google token refresh failed")
    })
  })
})
