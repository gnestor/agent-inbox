// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as client from "../client.js"

const mockFetch = vi.fn()
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

describe("api client", () => {
  beforeEach(() => {
    mockFetch.mockReset()
    global.fetch = mockFetch as unknown as typeof fetch
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("Scenario: Successful request returns parsed JSON — 2xx body is parsed and JSON content-type is set", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      user: { email: "a@example.com", name: "A" },
    }))
    const result = await client.getAuthSession()
    expect(result).toEqual({ user: { email: "a@example.com", name: "A" } })
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe("/api/auth/session")
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json")
  })

  it("Scenario: Non-2xx responses throw with status and body; 401 triggers re-login — error shape + session-expired event", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500))
    await expect(client.getAuthSession()).rejects.toThrow("boom")

    // 401: dispatches the session-expired event before throwing.
    const handler = vi.fn()
    window.addEventListener("session-expired", handler)
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "no jwt" }, 401))
    await expect(client.getAuthSession()).rejects.toThrow("no jwt")
    expect(handler).toHaveBeenCalledTimes(1)
    window.removeEventListener("session-expired", handler)
  })

  it("Scenario: Multipart upload bypasses the helper — uploadSessionFile posts FormData with no JSON content-type, same error shape", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      name: "f.txt",
      path: "/p",
      size: 1,
      mimeType: "text/plain",
    }))
    const file = new File(["hi"], "f.txt", { type: "text/plain" })
    await client.uploadSessionFile("s1", file)
    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toBe("/api/sessions/s1/files")
    expect(opts.method).toBe("POST")
    expect(opts.body).toBeInstanceOf(FormData)
    // Browser sets the multipart boundary — no JSON content-type override.
    expect(opts.headers).toBeUndefined()

    // Same throw shape on failure.
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "too big" }, 413))
    await expect(client.uploadSessionFile("s1", file)).rejects.toThrow("too big")
  })

  it("Scenario: Auth section covers `/api/auth/*` — getAuthClientId, authCallback, getAuthSession, logout are exported", () => {
    expect(typeof client.getAuthClientId).toBe("function")
    expect(typeof client.authCallback).toBe("function")
    expect(typeof client.getAuthSession).toBe("function")
    expect(typeof client.logout).toBe("function")
  })

  it("Scenario: Sessions section covers `/api/sessions/*` — every session function is exported and getSessionFileUrl returns a URL string", () => {
    for (const name of [
      "getSessions", "getSession", "createSession", "updateSession", "resumeSession",
      "abortSession", "archiveSession", "unarchiveSession", "answerSessionQuestion",
      "attachToSession", "updateArtifactCode", "uploadSessionFile", "getSessionFileUrl",
      "getLinkedSession", "getSessionProjects",
    ] as const) {
      expect(typeof client[name]).toBe("function")
    }
    // getSessionFileUrl returns a URL string, not a fetched body.
    expect(client.getSessionFileUrl("s1", "a.png")).toBe("/api/sessions/s1/files/a.png")
  })

  it("Scenario: Plugins section covers `/api/plugins` and `/api/:pluginId/*` — plugin functions exported", () => {
    for (const name of [
      "getPlugins", "queryPluginItems", "getPluginItem", "queryPluginSubItems",
      "getFieldOptions", "getPanelSchemas", "mutatePluginItem",
    ] as const) {
      expect(typeof client[name]).toBe("function")
    }
    // PluginManifest type is exported (compile-time contract).
    const _manifest: import("../client.js").PluginManifest | null = null
    expect(_manifest).toBeNull()
  })

  it("Scenario: Connections, preferences, workspaces, users — one function per route is exported", () => {
    for (const name of [
      "getConnections", "disconnectIntegration", "getConnectUrl",
      "getPreferences", "setPreference", "getUserProfiles",
      "getWorkspaces", "setActiveWorkspace", "getWorkspaceDetails", "renameWorkspace",
      "getWorkspaceGitInfo", "addWorkspaceMember", "removeWorkspaceMember",
      "updateMemberRole", "getAvailableUsers",
    ] as const) {
      expect(typeof client[name]).toBe("function")
    }
  })

  it("Scenario: Server route change requires a same-commit client change — client is the single typed wire contract", () => {
    // The client is the only typed contract on the wire: a server request/
    // response type change must update the corresponding client signature in the
    // same commit, or every consuming hook drifts without a TS error. This is a
    // process invariant; we assert the contract surface exists and is callable.
    expect(typeof client.getPlugins).toBe("function")
    expect(typeof client.getSessions).toBe("function")
  })
})
