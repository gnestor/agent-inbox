import { vi, describe, it, expect, beforeEach } from "vitest"
import { Hono } from "hono"
import { z } from "zod"
import type { AppBindings } from "../../lib/workspace-context.js"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockQuery = vi.fn()
const mockGetItem = vi.fn()
const mockMutate = vi.fn()
const mockQuerySubItems = vi.fn()

const fakePlugin = {
  id: "test-plugin",
  name: "Test Plugin",
  icon: "test",
  fieldSchema: [{ key: "title", label: "Title" }],
  query: mockQuery,
  getItem: mockGetItem,
  mutate: mockMutate,
  querySubItems: mockQuerySubItems,
  actionSchemas: {
    archive: z.object({ reason: z.string() }),
  },
}

vi.mock("../../lib/plugin-loader.js", () => ({
  getPlugins: vi.fn((_workspaceId?: string) => [fakePlugin]),
  getPlugin: vi.fn((id: string, _workspaceId?: string) => {
    if (id === "test-plugin") return fakePlugin
    return undefined
  }),
  getPluginDir: vi.fn(() => undefined),
}))

vi.mock("../../lib/plugin-context.js", () => ({
  buildPluginContext: vi.fn(async () => ({ db: "fake-db" })),
  getWorkspaceId: vi.fn(() => "ws-1"),
}))

// ---------------------------------------------------------------------------
// Import after mocks are in place
// ---------------------------------------------------------------------------

import { pluginRoutes } from "../plugins.js"

function createApp() {
  const app = new Hono<AppBindings>()
  app.use("*", async (c, next) => {
    c.set("workspace", { id: "ws-1", name: "test", path: "/workspace", role: "admin" })
    c.set("user", { name: "Test User", email: "test@example.com" })
    await next()
  })
  app.route("/api", pluginRoutes)
  return app
}

function postJson(app: Hono<AppBindings>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("plugin routes", () => {
  let app: Hono<AppBindings>

  beforeEach(() => {
    app = createApp()
    vi.clearAllMocks()
  })

  describe("GET /:pluginId/items", () => {
    it("returns items from plugin.query()", async () => {
      mockQuery.mockResolvedValueOnce({ items: [{ id: "1", title: "Item 1" }], nextCursor: null })

      const res = await app.request("/api/test-plugin/items")
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.items).toHaveLength(1)
      expect(data.items[0].id).toBe("1")
      expect(mockQuery).toHaveBeenCalledWith({}, undefined, expect.anything())
    })

    it("passes query parameters as filters", async () => {
      mockQuery.mockResolvedValueOnce({ items: [], nextCursor: null })

      await app.request("/api/test-plugin/items?status=active&cursor=abc")

      expect(mockQuery).toHaveBeenCalledWith(
        { status: "active" },
        "abc",
        expect.anything(),
      )
    })

    it("returns 404 for unknown plugin", async () => {
      const res = await app.request("/api/unknown-plugin/items")
      expect(res.status).toBe(404)
    })
  })

  describe("GET /:pluginId/items/:id", () => {
    it("returns single item from plugin.getItem()", async () => {
      mockGetItem.mockResolvedValueOnce({ id: "42", title: "Found item" })

      const res = await app.request("/api/test-plugin/items/42")
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.id).toBe("42")
      expect(mockGetItem).toHaveBeenCalledWith("42", expect.anything())
    })

    it("returns 404 when item not found", async () => {
      mockGetItem.mockResolvedValueOnce(null)

      const res = await app.request("/api/test-plugin/items/999")
      expect(res.status).toBe(404)
    })
  })

  describe("POST /:pluginId/items/:id/mutate", () => {
    it("calls plugin.mutate() with action and payload", async () => {
      mockMutate.mockResolvedValueOnce(undefined)

      const res = await postJson(app, "/api/test-plugin/items/42/mutate", {
        action: "toggle",
        payload: { done: true },
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(mockMutate).toHaveBeenCalledWith("42", "toggle", { done: true }, expect.anything())
    })

    it("returns 400 when action is missing", async () => {
      const res = await postJson(app, "/api/test-plugin/items/42/mutate", {
        payload: { done: true },
      })

      expect(res.status).toBe(400)
    })

    it("returns 400 when action is not a string", async () => {
      const res = await postJson(app, "/api/test-plugin/items/42/mutate", {
        action: 123,
      })

      expect(res.status).toBe(400)
    })

    it("validates payload against actionSchemas", async () => {
      // "archive" action has a schema requiring { reason: string }
      const res = await postJson(app, "/api/test-plugin/items/42/mutate", {
        action: "archive",
        payload: { reason: 123 }, // wrong type
      })

      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toContain("Invalid payload")
    })

    it("passes validated payload to mutate when schema matches", async () => {
      mockMutate.mockResolvedValueOnce(undefined)

      const res = await postJson(app, "/api/test-plugin/items/42/mutate", {
        action: "archive",
        payload: { reason: "no longer needed" },
      })

      expect(res.status).toBe(200)
      expect(mockMutate).toHaveBeenCalledWith(
        "42",
        "archive",
        { reason: "no longer needed" },
        expect.anything(),
      )
    })

    it("returns 404 for unknown plugin", async () => {
      const res = await postJson(app, "/api/unknown-plugin/items/42/mutate", {
        action: "toggle",
      })

      expect(res.status).toBe(404)
    })
  })
})
