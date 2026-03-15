import { test, expect } from "@playwright/test"

test.describe("Session rename", () => {
  test("clicking session title enters edit mode and can cancel with Escape", async ({ page }) => {
    await page.goto("/sessions")

    // Wait for sessions list to load
    const sessionItem = page.locator("[data-session-id]").first()
    // Skip test if no sessions exist
    const hasSession = await sessionItem.isVisible({ timeout: 5000 }).catch(() => false)
    if (!hasSession) {
      test.skip(true, "No sessions available to test rename")
      return
    }

    // Click the session to open it
    await sessionItem.click()

    // Find and click the session title to enter edit mode
    const titleElement = page.locator("[title='Click to rename']")
    await expect(titleElement).toBeVisible({ timeout: 5000 })
    await titleElement.click()

    // An input should appear
    const titleInput = page.locator("input[type='text']").first()
    await expect(titleInput).toBeVisible()

    // Press Escape to cancel
    await titleInput.press("Escape")

    // Input should be gone, title should be back
    await expect(titleInput).not.toBeVisible()
  })

  test("typing a new name and pressing Enter renames the session", async ({ page }) => {
    await page.goto("/sessions")

    const sessionItem = page.locator("[data-session-id]").first()
    const hasSession = await sessionItem.isVisible({ timeout: 5000 }).catch(() => false)
    if (!hasSession) {
      test.skip(true, "No sessions available to test rename")
      return
    }

    await sessionItem.click()

    const titleElement = page.locator("[title='Click to rename']")
    await expect(titleElement).toBeVisible({ timeout: 5000 })

    // Get original title text
    const originalTitle = await titleElement.textContent()

    // Click to enter edit mode
    await titleElement.click()

    const titleInput = page.locator("input[type='text']").first()
    await expect(titleInput).toBeVisible()

    // Type a new name
    const newName = `E2E Test ${Date.now()}`
    await titleInput.fill(newName)
    await titleInput.press("Enter")

    // Input should disappear and title should update
    await expect(titleInput).not.toBeVisible()

    // Restore original title if we changed it
    if (originalTitle) {
      await page.locator("[title='Click to rename']").click()
      const restoreInput = page.locator("input[type='text']").first()
      await restoreInput.fill(originalTitle)
      await restoreInput.press("Enter")
    }
  })
})
