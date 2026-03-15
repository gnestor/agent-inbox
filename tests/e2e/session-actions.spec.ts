import { test, expect } from "@playwright/test"

test.describe("Session action menu", () => {
  test("sparkles button opens menu with New session and Add to existing session", async ({ page }) => {
    await page.goto("/emails")

    // Wait for email list to load and click the first email
    const emailItem = page.locator("[data-thread-id]").first()
    const hasEmail = await emailItem.isVisible({ timeout: 10000 }).catch(() => false)
    if (!hasEmail) {
      test.skip(true, "No emails available to test session actions")
      return
    }

    await emailItem.click()

    // Find the Sparkles button (session actions trigger) by its title
    const sparklesButton = page.locator("button[title='Session actions']")
    await expect(sparklesButton).toBeVisible({ timeout: 5000 })

    // Click to open the dropdown
    await sparklesButton.click()

    // Verify dropdown items
    await expect(page.getByText("New session")).toBeVisible()
    await expect(page.getByText("Add to existing session")).toBeVisible()

    // Verify search input is present
    await expect(page.getByPlaceholder("Search sessions...")).toBeVisible()

    // Press Escape to close
    await page.keyboard.press("Escape")

    // Dropdown should close
    await expect(page.getByText("Add to existing session")).not.toBeVisible()
  })
})
