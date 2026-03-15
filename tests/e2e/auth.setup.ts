import { test as setup } from "@playwright/test"
import Database from "better-sqlite3"
import { resolve } from "path"

const DB_PATH = resolve(__dirname, "../../data/inbox.db")
const AUTH_FILE = resolve(__dirname, ".auth/user.json")

setup("authenticate", async ({ page }) => {
  // Insert a test user and session directly into SQLite
  const db = new Database(DB_PATH)

  db.exec(`
    INSERT OR IGNORE INTO users (email, name, created_at, last_login_at)
    VALUES ('test@hammies.com', 'Test User', datetime('now'), datetime('now'))
  `)

  db.exec(`
    INSERT OR REPLACE INTO auth_sessions (token, user_name, user_email, user_picture, created_at)
    VALUES ('test-e2e-token', 'Test User', 'test@hammies.com', NULL, datetime('now'))
  `)

  db.close()

  // Set the session cookie
  await page.context().addCookies([
    {
      name: "inbox_session",
      value: "test-e2e-token",
      domain: "localhost",
      path: "/",
    },
  ])

  // Verify auth works by loading the app
  await page.goto("/")
  await page.waitForURL((url) => !url.pathname.includes("/login"))

  // Save storage state for other tests to reuse
  await page.context().storageState({ path: AUTH_FILE })
})
