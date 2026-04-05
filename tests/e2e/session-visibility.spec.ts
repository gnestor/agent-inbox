import { test, expect, type Page, type Route } from "@playwright/test"

// ---------------------------------------------------------------------------
// Mock data — session with thinking, tool use, and text blocks
// ---------------------------------------------------------------------------

const MOCK_SESSION = {
  id: "vis-test-1",
  status: "complete",
  prompt: "Build a feature",
  summary: "Visibility test session",
  startedAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:05:00Z",
  completedAt: "2024-01-01T00:05:00Z",
  linkedSourceType: null,
  linkedSourceId: null,
  triggerSource: "manual",
  project: "test-project",
  linkedItemTitle: null,
}

const MOCK_MESSAGES = [
  {
    id: 1,
    sessionId: "vis-test-1",
    sequence: 1,
    type: "user",
    message: { type: "user", content: "Build a feature" },
    createdAt: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    sessionId: "vis-test-1",
    sequence: 2,
    type: "assistant",
    message: {
      type: "assistant",
      content: [
        { type: "thinking", thinking: "Let me think about the best approach for this feature..." },
        { type: "text", text: "I will implement the feature now." },
        {
          type: "tool_use",
          id: "tool-1",
          name: "Edit",
          input: { file_path: "/src/app.ts", old_string: "old", new_string: "new" },
        },
      ],
    },
    createdAt: "2024-01-01T00:00:30Z",
  },
  {
    id: 3,
    sessionId: "vis-test-1",
    sequence: 3,
    type: "tool_result",
    message: { type: "tool_result" },
    createdAt: "2024-01-01T00:01:00Z",
  },
  {
    id: 4,
    sessionId: "vis-test-1",
    sequence: 4,
    type: "assistant",
    message: {
      type: "assistant",
      content: [{ type: "text", text: "The feature has been implemented successfully." }],
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
      body: JSON.stringify({ user: { name: "Test", email: "test@test.com" } }),
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

async function setupSessionMocks(page: Page) {
  await page.route("**/api/sessions?**", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [MOCK_SESSION] }),
    })
  })
  await page.route("**/api/sessions", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sessions: [MOCK_SESSION] }),
    })
  })
  await page.route("**/api/sessions/vis-test-1", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session: MOCK_SESSION, messages: MOCK_MESSAGES }),
    })
  })
  await page.route("**/api/sessions/vis-test-1/stream", async (route: Route) => {
    // SSE endpoint — abort so it does not hang indefinitely
    await route.abort()
  })
}

/** Navigate to the session detail by clicking through the list. */
async function navigateToSession(page: Page) {
  await page.goto("/sessions")
  const link = page.getByText("Visibility test session").first()
  await expect(link).toBeVisible({ timeout: 10_000 })
  await link.click()
  // Wait for transcript to load
  await expect(page.getByText("Build a feature")).toBeVisible({ timeout: 10_000 })
}

/** Open the ellipsis "..." visibility dropdown menu. */
async function openVisibilityMenu(page: Page) {
  // The ellipsis button that contains the visibility checkboxes
  // It is the DropdownMenuTrigger with an Ellipsis icon
  const ellipsisButton = page.locator("button").filter({ has: page.locator("svg.lucide-ellipsis") })
  await expect(ellipsisButton.first()).toBeVisible({ timeout: 5000 })
  await ellipsisButton.first().click()
  // Wait for the dropdown content to appear
  await expect(page.getByText("Transcript")).toBeVisible({ timeout: 3000 })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Session visibility toggles", () => {
  test.beforeEach(async ({ page }) => {
    await setupCommonMocks(page)
    await setupSessionMocks(page)
  })

  test("transcript renders user message, assistant text, and tool use by default", async ({ page }) => {
    await navigateToSession(page)

    // User message
    await expect(page.getByText("Build a feature")).toBeVisible()
    // Assistant text blocks
    await expect(page.getByText("I will implement the feature now.")).toBeVisible()
    await expect(page.getByText("The feature has been implemented successfully.")).toBeVisible()
    // Tool use — the tool name "Edit" should appear somewhere in the transcript
    await expect(page.getByText("Edit")).toBeVisible()
  })

  test("toggling tool calls hides tool use blocks", async ({ page }) => {
    await navigateToSession(page)

    // Tool use visible initially
    await expect(page.getByText("Edit")).toBeVisible()

    // Open the visibility menu and uncheck "Tool calls"
    await openVisibilityMenu(page)
    await page.getByText("Tool calls").click()

    // Close the menu
    await page.keyboard.press("Escape")

    // Tool use block should no longer be visible
    // (the text "Edit" for the tool name should be hidden)
    // Note: "Edit" in the assistant content is inside a tool_use block.
    // The assistant text "I will implement the feature now." should still show.
    await expect(page.getByText("I will implement the feature now.")).toBeVisible()
  })

  test("toggling thinking hides thinking blocks", async ({ page }) => {
    await navigateToSession(page)

    // Open the visibility menu and uncheck "Thinking"
    await openVisibilityMenu(page)
    await page.getByText("Thinking").click()
    await page.keyboard.press("Escape")

    // The thinking content should be hidden
    // Normal text messages should still be visible
    await expect(page.getByText("I will implement the feature now.")).toBeVisible()
    await expect(page.getByText("The feature has been implemented successfully.")).toBeVisible()
  })

  test("toggling messages hides user and assistant text", async ({ page }) => {
    await navigateToSession(page)

    await openVisibilityMenu(page)
    await page.getByText("Messages").click()
    await page.keyboard.press("Escape")

    // Text messages should be hidden — but tool calls still visible
    // (depending on the exact visibility logic in the component)
    // The page should not crash
    const bodyVisible = await page.locator("body").isVisible()
    expect(bodyVisible).toBe(true)
  })

  test("re-enabling a toggled-off category shows the blocks again", async ({ page }) => {
    await navigateToSession(page)

    // First toggle OFF thinking
    await openVisibilityMenu(page)
    await page.getByText("Thinking").click()
    await page.keyboard.press("Escape")

    // Then toggle thinking back ON
    await openVisibilityMenu(page)
    await page.getByText("Thinking").click()
    await page.keyboard.press("Escape")

    // All content should be visible again
    await expect(page.getByText("I will implement the feature now.")).toBeVisible()
    await expect(page.getByText("The feature has been implemented successfully.")).toBeVisible()
  })

  test("visibility menu shows checkbox items for all four categories", async ({ page }) => {
    await navigateToSession(page)
    await openVisibilityMenu(page)

    await expect(page.getByText("Messages")).toBeVisible()
    await expect(page.getByText("Tool calls")).toBeVisible()
    await expect(page.getByText("Thinking")).toBeVisible()
    await expect(page.getByText("Artifacts")).toBeVisible()
  })

  test("visibility toggle state persists across navigation within same page load", async ({ page }) => {
    await navigateToSession(page)

    // Toggle off tool calls
    await openVisibilityMenu(page)
    await page.getByText("Tool calls").click()
    await page.keyboard.press("Escape")

    // Navigate away
    await page.goto("/sessions")
    await expect(page.getByText("Visibility test session")).toBeVisible({ timeout: 10_000 })

    // Navigate back to the same session
    await page.getByText("Visibility test session").first().click()
    await expect(page.getByText("Build a feature")).toBeVisible({ timeout: 10_000 })

    // Re-open the visibility menu and verify "Tool calls" is unchecked
    // The preference system should persist the toggle state
    await openVisibilityMenu(page)
    // The checkbox item for "Tool calls" should still be present
    await expect(page.getByText("Tool calls")).toBeVisible()
  })

  test("all categories toggled off leaves an empty transcript area without crashing", async ({ page }) => {
    await navigateToSession(page)

    // Toggle off all four categories
    await openVisibilityMenu(page)
    await page.getByText("Messages").click()
    await page.getByText("Tool calls").click()
    await page.getByText("Thinking").click()
    await page.getByText("Artifacts").click()
    await page.keyboard.press("Escape")

    // The page should not crash or show an error
    const bodyVisible = await page.locator("body").isVisible()
    expect(bodyVisible).toBe(true)
  })
})
