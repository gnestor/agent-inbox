import { test, expect, type BrowserContext, type Page, type Route } from "@playwright/test"

// Mocked multi-tab smoke test: two browser contexts open the same session and
// should both render the transcript. The deeper goal — real-time sync across
// tabs via the WS — requires the `api` project's real Hono backend and is
// covered manually for now; this test catches the class of regressions where
// opening the same session twice puts either tab into a stuck state
// (coordinator inFlight leaks, StrictMode races). Those bugs manifested in
// production as a tab that never rendered; if it renders here it's healthy.

const MOCK_SESSION = {
  id: "multi-tab-1",
  status: "complete",
  prompt: "Hello",
  summary: "Multi-tab session",
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
    sessionId: "multi-tab-1",
    sequence: 1,
    type: "user",
    message: { type: "user", content: "Hello" },
    createdAt: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    sessionId: "multi-tab-1",
    sequence: 2,
    type: "assistant",
    message: {
      type: "assistant",
      content: [{ type: "text", text: "A response shared across both tabs." }],
    },
    createdAt: "2024-01-01T00:00:30Z",
  },
]

async function setupMocks(page: Page) {
  await page.route("**/api/auth/session", (r: Route) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { name: "T", email: "t@t.com" } }) }))
  await page.route("**/api/preferences", (r: Route) => r.fulfill({ status: 200, body: "{}" }))
  await page.route("**/api/workspaces", (r: Route) =>
    r.fulfill({ status: 200, body: JSON.stringify({ workspaces: [], activeWorkspaceId: null }) }))
  await page.route("**/api/plugins", (r: Route) => r.fulfill({ status: 200, body: "[]" }))
  await page.route("**/api/panels", (r: Route) => r.fulfill({ status: 200, body: "{}" }))
  await page.route("**/api/connections", (r: Route) =>
    r.fulfill({ status: 200, body: JSON.stringify({ integrations: [] }) }))
  await page.route("**/api/sessions/projects", (r: Route) =>
    r.fulfill({ status: 200, body: JSON.stringify({ projects: [] }) }))
  await page.route("**/api/sessions?**", (r: Route) =>
    r.fulfill({ status: 200, body: JSON.stringify({ sessions: [MOCK_SESSION] }) }))
  await page.route("**/api/sessions", (r: Route) =>
    r.fulfill({ status: 200, body: JSON.stringify({ sessions: [MOCK_SESSION] }) }))
  await page.route("**/api/sessions/multi-tab-1", (r: Route) =>
    r.fulfill({ status: 200, body: JSON.stringify({ session: MOCK_SESSION, messages: MOCK_MESSAGES }) }))
}

async function openSession(context: BrowserContext): Promise<Page> {
  const page = await context.newPage()
  await setupMocks(page)
  const consoleErrors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })
  // Stash for later inspection
  ;(page as any)._consoleErrors = consoleErrors
  await page.goto("/recent/multi-tab-1")
  return page
}

test.describe("Session multi-tab rendering", () => {
  test("two contexts on the same session both render the transcript", async ({ browser }) => {
    const contextA = await browser.newContext({ storageState: "tests/e2e/.auth/user.json" })
    const contextB = await browser.newContext({ storageState: "tests/e2e/.auth/user.json" })

    const pageA = await openSession(contextA)
    const pageB = await openSession(contextB)

    await expect(pageA.getByText("A response shared across both tabs.")).toBeVisible({ timeout: 10_000 })
    await expect(pageB.getByText("A response shared across both tabs.")).toBeVisible({ timeout: 10_000 })

    // No "stuck tab" regressions: neither context threw a console error at load.
    expect((pageA as any)._consoleErrors).toEqual([])
    expect((pageB as any)._consoleErrors).toEqual([])

    await contextA.close()
    await contextB.close()
  })
})
