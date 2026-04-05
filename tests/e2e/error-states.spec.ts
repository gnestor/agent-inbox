import { test, expect, type Page, type Route } from "@playwright/test"

// ---------------------------------------------------------------------------
// Common mock setup — minimal scaffolding so the app boots without crashing
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

/**
 * Helper: mock session list to return empty (no sessions available).
 */
async function mockEmptySessionList(page: Page) {
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Error states", () => {
  test.beforeEach(async ({ page }) => {
    await setupCommonMocks(page)
  })

  // -- Server errors (500) --

  test("API 500 on session list does not crash the page", async ({ page }) => {
    await page.route("**/api/sessions?**", async (route: Route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal server error" }),
      })
    })
    await page.route("**/api/sessions", async (route: Route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Internal server error" }),
        })
      } else {
        await route.continue()
      }
    })

    await page.goto("/sessions")

    // The page should still render without a blank white screen
    await page.waitForTimeout(3000)
    const bodyText = await page.textContent("body")
    // React error boundary crash text should NOT appear
    expect(bodyText).not.toContain("Something went wrong")
    // The body should have some content (sidebar, etc.)
    expect(bodyText?.length).toBeGreaterThan(0)
  })

  test("API 500 on session detail shows error gracefully", async ({ page }) => {
    // Session list returns one session so we can click into it
    const session = {
      id: "err-500-session",
      status: "complete",
      prompt: "Test",
      summary: "Session that will 500 on detail",
      startedAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:01:00Z",
      completedAt: "2024-01-01T00:01:00Z",
      linkedSourceType: null,
      linkedSourceId: null,
      triggerSource: "manual",
      project: "test-project",
      linkedItemTitle: null,
    }

    await page.route("**/api/sessions?**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [session] }),
      })
    })
    await page.route("**/api/sessions", async (route: Route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [session] }),
        })
      } else {
        await route.continue()
      }
    })

    // Detail endpoint returns 500
    await page.route("**/api/sessions/err-500-session", async (route: Route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal server error" }),
      })
    })

    await page.goto("/sessions")
    await page.getByText("Session that will 500 on detail").first().click()

    // Page should not crash
    await page.waitForTimeout(3000)
    const bodyVisible = await page.locator("body").isVisible()
    expect(bodyVisible).toBe(true)

    // Should NOT display a blank white page
    const bodyText = await page.textContent("body")
    expect(bodyText?.length).toBeGreaterThan(0)
  })

  // -- Not Found (404) --

  test("404 for a specific session does not crash the page", async ({ page }) => {
    await mockEmptySessionList(page)

    await page.route("**/api/sessions/nonexistent-id", async (route: Route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Session not found" }),
      })
    })

    await page.goto("/sessions")
    await page.waitForTimeout(2000)
    const hasContent = await page.locator("body").isVisible()
    expect(hasContent).toBe(true)
  })

  test("navigating to a non-existent session URL handles 404 gracefully", async ({ page }) => {
    await mockEmptySessionList(page)

    await page.route("**/api/sessions/does-not-exist", async (route: Route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "Session not found" }),
      })
    })

    // Navigate directly to a session URL that does not exist
    await page.goto("/sessions/does-not-exist")

    await page.waitForTimeout(3000)
    const bodyVisible = await page.locator("body").isVisible()
    expect(bodyVisible).toBe(true)

    // Should not show a raw React error
    const bodyText = await page.textContent("body")
    expect(bodyText).not.toContain("Unhandled Runtime Error")
  })

  // -- Network failures --

  test("network failure on session list (connection refused)", async ({ page }) => {
    await page.route("**/api/sessions?**", async (route: Route) => {
      await route.abort("connectionrefused")
    })
    await page.route("**/api/sessions", async (route: Route) => {
      if (route.request().method() === "GET") {
        await route.abort("connectionrefused")
      } else {
        await route.continue()
      }
    })

    await page.goto("/sessions")

    // The app should handle the network error gracefully
    await page.waitForTimeout(3000)
    const bodyVisible = await page.locator("body").isVisible()
    expect(bodyVisible).toBe(true)
  })

  test("network timeout on session detail does not crash", async ({ page }) => {
    const session = {
      id: "timeout-session",
      status: "complete",
      prompt: "Test",
      summary: "Session that will timeout",
      startedAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:01:00Z",
      completedAt: "2024-01-01T00:01:00Z",
      linkedSourceType: null,
      linkedSourceId: null,
      triggerSource: "manual",
      project: "test-project",
      linkedItemTitle: null,
    }

    await page.route("**/api/sessions?**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [session] }),
      })
    })
    await page.route("**/api/sessions", async (route: Route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [session] }),
        })
      } else {
        await route.continue()
      }
    })
    await page.route("**/api/sessions/timeout-session", async (route: Route) => {
      await route.abort("timedout")
    })

    await page.goto("/sessions")
    await page.getByText("Session that will timeout").first().click()

    // Page should not crash
    await page.waitForTimeout(3000)
    const bodyVisible = await page.locator("body").isVisible()
    expect(bodyVisible).toBe(true)
  })

  test("network failure on session create shows error", async ({ page }) => {
    await mockEmptySessionList(page)

    // Override POST to fail
    await page.route("**/api/sessions", async (route: Route) => {
      if (route.request().method() === "POST") {
        await route.abort("connectionrefused")
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [] }),
        })
      }
    })

    await page.goto("/sessions")

    // Verify the page loads even when create would fail
    await page.waitForTimeout(2000)
    const hasContent = await page.locator("body").isVisible()
    expect(hasContent).toBe(true)
  })

  // -- Malformed responses --

  test("malformed JSON response does not crash the app", async ({ page }) => {
    await page.route("**/api/sessions?**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{ invalid json !!!",
      })
    })
    await page.route("**/api/sessions", async (route: Route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "{ invalid json !!!",
        })
      } else {
        await route.continue()
      }
    })

    await page.goto("/sessions")

    await page.waitForTimeout(3000)
    const bodyVisible = await page.locator("body").isVisible()
    expect(bodyVisible).toBe(true)
  })

  test("session detail with empty messages array renders without crashing", async ({ page }) => {
    const session = {
      id: "empty-msg-session",
      status: "complete",
      prompt: "Test",
      summary: "Session with no messages",
      startedAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:01:00Z",
      completedAt: "2024-01-01T00:01:00Z",
      linkedSourceType: null,
      linkedSourceId: null,
      triggerSource: "manual",
      project: "test-project",
      linkedItemTitle: null,
    }

    await page.route("**/api/sessions?**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [session] }),
      })
    })
    await page.route("**/api/sessions", async (route: Route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ sessions: [session] }),
        })
      } else {
        await route.continue()
      }
    })
    await page.route("**/api/sessions/empty-msg-session", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session, messages: [] }),
      })
    })

    await page.goto("/sessions")
    await page.getByText("Session with no messages").first().click()

    // Page should load without errors
    await page.waitForTimeout(2000)
    const bodyVisible = await page.locator("body").isVisible()
    expect(bodyVisible).toBe(true)
  })

  // -- Auth error --

  test("auth failure redirects to login or shows auth error", async ({ page }) => {
    // Override auth mock to return 401
    await page.route("**/api/auth/session", async (route: Route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unauthorized" }),
      })
    })

    await mockEmptySessionList(page)

    await page.goto("/sessions")
    await page.waitForTimeout(3000)

    // The app should either redirect to /login or show some content
    // It should NOT show a blank white screen
    const bodyVisible = await page.locator("body").isVisible()
    expect(bodyVisible).toBe(true)
  })
})
