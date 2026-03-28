import { test as setup } from "@playwright/test"
import pg from "pg"
import { resolve } from "path"

const AUTH_FILE = resolve(__dirname, ".auth/user.json")

setup("authenticate", async ({ page }) => {
  // Insert a test user and session directly into PostgreSQL
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()

  const now = new Date().toISOString()

  await client.query(
    `INSERT INTO users (email, name, created_at, last_login_at)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT (email) DO NOTHING`,
    ["test@hammies.com", "Test User", now],
  )

  await client.query(
    `INSERT INTO auth_sessions (token, user_name, user_email, user_picture, created_at)
     VALUES ($1, $2, $3, NULL, $4)
     ON CONFLICT (token) DO UPDATE SET
       user_name = EXCLUDED.user_name,
       user_email = EXCLUDED.user_email,
       created_at = EXCLUDED.created_at`,
    ["test-e2e-token", "Test User", "test@hammies.com", now],
  )

  await client.end()

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
