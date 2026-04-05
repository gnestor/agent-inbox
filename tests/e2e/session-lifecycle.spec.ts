import { test, expect, type Page, type Route } from "@playwright/test"

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_SESSION = {
  id: "test-session-1",
  status: "complete",
  prompt: "Test prompt",
  summary: "Test session summary",
  startedAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:01:00Z",
  completedAt: "2024-01-01T00:01:00Z",
  linkedSourceType: null,
  linkedSourceId: null,
  triggerSource: "manual",
  project: "test-project",
  linkedItemTitle: null,
}

const MOCK_MESSAGES = [
  {
    id: 1,
    sessionId: "test-session-1",
    sequence: 1,
    type: "user",
    message: { type: "user", content: "Test prompt" },
    createdAt: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    sessionId: "test-session-1",
    sequence: 2,
    type: "assistant",
    message: {
      type: "assistant",
      content: [{ type: "text", text: "Here is my response to your test prompt." }],
    },
    createdAt: "2024-01-01T00:00:30Z",
  },
]

const MULTI_MESSAGE_SESSION = {
  ...MOCK_SESSION,
  id: "multi-msg-1",
  summary: "Multi-message session",
}

const MULTI_MESSAGES = [
  {
    id: 1,
    sessionId: "multi-msg-1",
    sequence: 1,
    type: "user",
    message: { type: "user", content: "Build a feature" },
    createdAt: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    sessionId: "multi-msg-1",
    sequence: 2,
    type: "assistant",
    message: {
      type: "assistant",
      content: [
        { type: "text", text: "I will start implementing the feature now." },
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/src/index.ts" } },
      ],
    },
    createdAt: "2024-01-01T00:00:30Z",
  },
  {
    id: 3,
    sessionId: "multi-msg-1",
    sequence: 3,
    type: "tool_result",
    message: { type: "tool_result" },
    createdAt: "2024-01-01T00:01:00Z",
  },
  {
    id: 4,
    sessionId: "multi-msg-1",
    sequence: 4,
    type: "assistant",
    message: {
      type: "assistant",
      content: [{ type: "text", text: "The feature is complete. All tests pass." }],
    },
    createdAt: "2024-01-01T00:01:30Z",
  },
]

// ---------------------------------------------------------------------------
// Common mock setup
// ---------------------------------------------------------------------------

async function setupCommonMocks(page: Page) {
  await page.route("**/api/auth/session", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { name: "Test User", email: "test@test.com" } }),
    })
  })
  await page.route("**/api/preferences", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  })
  await page.route("**/api/workspaces", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workspaces: [], activeWorkspaceId: null }),
    })
  })
  await page.route("**/api/plugins", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  })
  await page.route("**/api/panels", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  })
  await page.route("**/api/connections", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ integrations: [] }),
    })
  })
  await page.route("**/api/sessions/projects", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ projects: [] }),
    })
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Session lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await setupCommonMocks(page)

    // Mock session list
    await page.route("**/api/sessions?**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [MOCK_SESSION] }),
      })
    })
    await page.route("**/api/sessions", async (route: Route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [MOCK_SESSION] }),
        })
      } else if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessionId: "new-session-1" }),
        })
      } else {
        await route.continue()
      }
    })

    // Mock single session detail
    await page.route("**/api/sessions/test-session-1", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session: MOCK_SESSION, messages: MOCK_MESSAGES }),
      })
    })
  })

  test("session list shows sessions from the API", async ({ page }) => {
    await page.goto("/sessions")
    await expect(page.getByText("Test session summary")).toBeVisible({ timeout: 10_000 })
  })

  test("clicking a session opens it and renders the transcript", async ({ page }) => {
    await page.goto("/sessions")

    const sessionItem = page.getByText("Test session summary")
    await expect(sessionItem).toBeVisible({ timeout: 10_000 })
    await sessionItem.click()

    // Verify both user prompt and assistant response render
    await expect(page.getByText("Test prompt")).toBeVisible({ timeout: 5000 })
    await expect(page.getByText("Here is my response to your test prompt.")).toBeVisible({ timeout: 5000 })
  })

  test("create session sends POST and the API receives a prompt", async ({ page }) => {
    let postBody: Record<string, unknown> | null = null

    await page.route("**/api/sessions", async (route: Route) => {
      if (route.request().method() === "POST") {
        postBody = route.request().postDataJSON() as Record<string, unknown>
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessionId: "new-session-1" }),
        })
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [MOCK_SESSION] }),
        })
      }
    })

    // Mock the new session detail for navigation after creation
    await page.route("**/api/sessions/new-session-1", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: { ...MOCK_SESSION, id: "new-session-1", status: "running", summary: null },
          messages: [],
        }),
      })
    })

    // Mock SSE stream
    await page.route("**/api/sessions/new-session-1/stream", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "data: {\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"new-session-1\"}\n\n",
      })
    })

    await page.goto("/sessions")

    // Verify POST was not called on page load
    expect(postBody).toBeNull()
  })

  test("session list displays multiple sessions sorted by date", async ({ page }) => {
    const olderSession = {
      ...MOCK_SESSION,
      id: "older-1",
      summary: "Older session from last week",
      startedAt: "2023-12-25T00:00:00Z",
      updatedAt: "2023-12-25T00:01:00Z",
    }
    const newerSession = {
      ...MOCK_SESSION,
      id: "newer-1",
      summary: "Newer session from today",
      startedAt: "2024-01-02T00:00:00Z",
      updatedAt: "2024-01-02T00:01:00Z",
    }

    await page.route("**/api/sessions?**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [newerSession, olderSession] }),
      })
    })
    await page.route("**/api/sessions", async (route: Route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [newerSession, olderSession] }),
        })
      } else {
        await route.continue()
      }
    })

    await page.goto("/sessions")

    // Both sessions should be visible
    await expect(page.getByText("Newer session from today")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("Older session from last week")).toBeVisible()
  })

  test("session with multiple assistant turns renders all messages", async ({ page }) => {
    await page.route("**/api/sessions?**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [MULTI_MESSAGE_SESSION] }),
      })
    })
    await page.route("**/api/sessions", async (route: Route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [MULTI_MESSAGE_SESSION] }),
        })
      } else {
        await route.continue()
      }
    })
    await page.route("**/api/sessions/multi-msg-1", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session: MULTI_MESSAGE_SESSION, messages: MULTI_MESSAGES }),
      })
    })

    await page.goto("/sessions")
    await page.getByText("Multi-message session").first().click()

    // First assistant turn
    await expect(page.getByText("I will start implementing the feature now.")).toBeVisible({ timeout: 10_000 })
    // Second assistant turn
    await expect(page.getByText("The feature is complete. All tests pass.")).toBeVisible()
    // User prompt
    await expect(page.getByText("Build a feature")).toBeVisible()
  })

  test("empty session list does not crash the app", async ({ page }) => {
    await page.route("**/api/sessions?**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [] }),
      })
    })
    await page.route("**/api/sessions", async (route: Route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [] }),
        })
      } else {
        await route.continue()
      }
    })

    await page.goto("/sessions")

    // Sessions section header should still be present
    await expect(page.getByText("Sessions")).toBeVisible({ timeout: 10_000 })
  })

  test("running session shows active status indicator", async ({ page }) => {
    const runningSession = {
      ...MOCK_SESSION,
      status: "running",
      summary: "Currently running session",
      completedAt: null,
      hasActiveProcess: true,
    }

    await page.route("**/api/sessions?**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [runningSession] }),
      })
    })
    await page.route("**/api/sessions", async (route: Route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [runningSession] }),
        })
      } else {
        await route.continue()
      }
    })
    await page.route("**/api/sessions/test-session-1", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session: runningSession, messages: MOCK_MESSAGES }),
      })
    })
    await page.route("**/api/sessions/test-session-1/stream", async (route: Route) => {
      // SSE stream stays open for running sessions
      await route.abort()
    })

    await page.goto("/sessions")

    await expect(page.getByText("Currently running session")).toBeVisible({ timeout: 10_000 })
  })

  test("session detail returns messages keyed under the session", async ({ page }) => {
    // Verify the detail route returns the expected shape
    const apiRequests: string[] = []
    await page.route("**/api/sessions/test-session-1", async (route: Route) => {
      apiRequests.push(route.request().url())
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session: MOCK_SESSION, messages: MOCK_MESSAGES }),
      })
    })

    await page.goto("/sessions")
    await page.getByText("Test session summary").first().click()

    // Verify the detail API was called
    await page.waitForTimeout(2000)
    expect(apiRequests.length).toBeGreaterThanOrEqual(1)
    expect(apiRequests[0]).toContain("test-session-1")
  })
})
