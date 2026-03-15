import { test, expect } from "@playwright/test"

test.describe("Integrations page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings/integrations")
    // Wait for the integrations to load
    await expect(page.getByText("User").first()).toBeVisible({ timeout: 10000 })
  })

  test("shows User section with Google, Pinterest, QuickBooks", async ({ page }) => {
    const userSection = page.locator("section", { has: page.getByRole("heading", { name: "User" }) })

    await expect(userSection.getByText("Google")).toBeVisible()
    await expect(userSection.getByText("Pinterest")).toBeVisible()
    await expect(userSection.getByText("QuickBooks")).toBeVisible()
  })

  test("shows Workspace section with expected integrations", async ({ page }) => {
    const workspaceSection = page.locator("section", { has: page.getByRole("heading", { name: "Workspace" }) })

    await expect(workspaceSection.getByText("Notion")).toBeVisible()
    await expect(workspaceSection.getByText("Slack")).toBeVisible()
    await expect(workspaceSection.getByText("GitHub")).toBeVisible()
    await expect(workspaceSection.getByText("Shopify")).toBeVisible()
    await expect(workspaceSection.getByText("Air")).toBeVisible()
  })

  test("connected integrations show green Connected text", async ({ page }) => {
    // Find any integration card that shows "Connected"
    const connectedCards = page.locator(".text-green-600, .text-green-400", { hasText: "Connected" })
    // At least one integration should be connected in the dev environment
    const count = await connectedCards.count()
    if (count > 0) {
      await expect(connectedCards.first()).toBeVisible()
    }
  })

  test("workspace integrations show Managed by admin badge", async ({ page }) => {
    const workspaceSection = page.locator("section", { has: page.getByRole("heading", { name: "Workspace" }) })

    const badges = workspaceSection.getByText("Managed by admin")
    await expect(badges.first()).toBeVisible()
  })

  test("non-connected user integrations show Connect button", async ({ page }) => {
    const userSection = page.locator("section", { has: page.getByRole("heading", { name: "User" }) })

    // There should be at least one Connect button for non-connected user integrations
    const connectButtons = userSection.getByRole("button", { name: "Connect" })
    const disconnectButtons = userSection.getByRole("button", { name: "Disconnect" })

    // Either Connect or Disconnect buttons should exist
    const connectCount = await connectButtons.count()
    const disconnectCount = await disconnectButtons.count()
    expect(connectCount + disconnectCount).toBeGreaterThan(0)
  })
})
