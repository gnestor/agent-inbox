import { test as setup } from "@playwright/test"
import pg from "pg"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const AUTH_FILE = resolve(__dirname, ".auth/user.json")

setup("authenticate", async ({ page }) => {
  // Insert a test user and session directly into PostgreSQL
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL })
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

  // For integration tests (API-only, no Vite client), skip page navigation.
  // For mocked tests, verify auth by loading the app if the client is available.
  try {
    const res = await page.goto("/", { timeout: 5000 })
    if (res) await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 5000 })
  } catch {
    // Vite client not running — integration mode, skip page verification
  }

  // Save storage state for other tests to reuse
  await page.context().storageState({ path: AUTH_FILE })
})
