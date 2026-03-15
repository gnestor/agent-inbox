import { test, expect } from "@playwright/test"

test.describe("Navigation", () => {
  test("sidebar shows Sources and Sessions sections", async ({ page }) => {
    await page.goto("/emails")

    // Sources section with nav items
    await expect(page.getByText("Sources")).toBeVisible()
    await expect(page.getByText("Emails")).toBeVisible()
    await expect(page.getByText("Tasks")).toBeVisible()
    await expect(page.getByText("Calendar")).toBeVisible()

    // Sessions section (SidebarRecentSessions)
    await expect(page.getByText("Sessions")).toBeVisible()
  })

  test("clicking each source tab renders correct panel", async ({ page }) => {
    await page.goto("/emails")

    // Emails tab
    await page.getByRole("button", { name: "Emails" }).click()
    await expect(page).toHaveURL(/\/emails/)

    // Tasks tab
    await page.getByRole("button", { name: "Tasks" }).click()
    await expect(page).toHaveURL(/\/tasks/)

    // Calendar tab
    await page.getByRole("button", { name: "Calendar" }).click()
    await expect(page).toHaveURL(/\/calendar/)
  })

  test("navigate to integrations via sidebar dropdown", async ({ page }) => {
    await page.goto("/emails")

    // Open the sidebar dropdown (Hammies / Inbox header)
    await page.getByRole("button", { name: /Hammies/i }).click()

    // Click Integrations
    await page.getByRole("menuitem", { name: "Integrations" }).click()

    await expect(page).toHaveURL(/\/settings\/integrations/)
    await expect(page.getByText("Integrations").first()).toBeVisible()
  })

  test("from settings, navigate back to Emails tab", async ({ page }) => {
    // Start on integrations page
    await page.goto("/settings/integrations")
    await expect(page.getByText("Integrations").first()).toBeVisible()

    // Click Emails in sidebar to navigate back
    await page.getByRole("button", { name: "Emails" }).click()
    await expect(page).toHaveURL(/\/emails/)
  })
})
