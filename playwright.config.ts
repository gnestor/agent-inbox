import { defineConfig, devices } from "@playwright/test"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { config } from "dotenv"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load the inbox .env so DATABASE_URL and other vars are available
config({ path: resolve(__dirname, ".env") })

const testWorkspace = resolve(__dirname, "tests/e2e/fixtures/test-workspace")

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5175",
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    // Auth setup — shared by both suites
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },

    // Fast mocked tests (existing specs — use page.route() API mocking)
    {
      name: "mocked",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /integration\//,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },

    // Real-server integration tests (hit actual Hono server on :3002)
    {
      name: "integration",
      testDir: "./tests/e2e/integration",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:3002",
        storageState: "tests/e2e/.auth/user.json",
        // Send Origin header so CSRF middleware allows state-changing requests
        extraHTTPHeaders: {
          "Origin": "http://localhost:5175",
        },
      },
      dependencies: ["setup"],
    },
  ],

  // Auto-start the API server for integration tests (server-only, no Vite client).
  // Integration tests use API requests, not browser-rendered pages, so the Hono
  // server on port 3002 is sufficient. The mocked project doesn't need any server.
  webServer: {
    command: `WORKSPACE=${testWorkspace} npx tsx server/index.ts`,
    port: 3002,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://localhost:5432/inbox_test",
      VAULT_SECRET: process.env.VAULT_SECRET || "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "test-client-id",
      ALLOWED_ORIGINS: "http://localhost:5175,http://localhost:3002",
    },
  },
})
