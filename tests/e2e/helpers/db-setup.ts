/**
 * Test database setup/teardown helpers for E2E integration tests.
 *
 * These helpers connect directly to PostgreSQL (bypassing the app server)
 * to seed or clean data for deterministic test runs.
 */
import pg from "pg"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { config } from "dotenv"

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEST_WORKSPACE_PATH = resolve(__dirname, "../fixtures/test-workspace")

// Load env vars from the inbox .env (for DATABASE_URL)
// Playwright workers don't inherit the webServer's env
config({ path: resolve(__dirname, "../../../.env") })

function getConnectionString(): string {
  return process.env.DATABASE_URL || "postgresql://localhost:5432/inbox_test"
}

/** Truncate all data tables (preserving schema). Idempotent. */
export async function truncateAllTables(): Promise<void> {
  const connStr = getConnectionString()
  console.log(`[db-setup] truncating tables using ${connStr.replace(/:\/\/.*@/, "://***@")}`)
  const client = new pg.Client({ connectionString: connStr, connectionTimeoutMillis: 10_000 })
  await client.connect()
  try {
    await client.query(`
      TRUNCATE sessions, users, auth_sessions, workspaces, workspace_members,
               user_credentials, workspace_credentials
      CASCADE
    `)
    console.log("[db-setup] tables truncated")
  } finally {
    await client.end()
  }
}

/** Seed the minimum data needed for integration tests to run. */
export async function seedTestData(): Promise<void> {
  const client = new pg.Client({ connectionString: getConnectionString() })
  await client.connect()
  const now = new Date().toISOString()

  try {
    // Test user
    await client.query(
      `INSERT INTO users (email, name, created_at, last_login_at)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (email) DO NOTHING`,
      ["test@hammies.com", "Test User", now],
    )

    // Auth session (matches auth.setup.ts cookie)
    await client.query(
      `INSERT INTO auth_sessions (token, user_name, user_email, user_picture, created_at)
       VALUES ($1, $2, $3, NULL, $4)
       ON CONFLICT (token) DO UPDATE SET
         user_name = EXCLUDED.user_name,
         user_email = EXCLUDED.user_email,
         created_at = EXCLUDED.created_at`,
      ["test-e2e-token", "Test User", "test@hammies.com", now],
    )

    // Test workspace
    await client.query(
      `INSERT INTO workspaces (id, name, path, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, path = EXCLUDED.path`,
      ["test-ws", "Test Workspace", TEST_WORKSPACE_PATH, now],
    )

    // Link test user to workspace as admin
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_email, role, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, user_email) DO NOTHING`,
      ["test-ws", "test@hammies.com", "admin", now],
    )

    // Seed sessions with different statuses
    const sessions = [
      { id: "e2e-session-complete", status: "complete", prompt: "Build a feature", summary: "Feature built successfully" },
      { id: "e2e-session-archived", status: "archived", prompt: "Old task", summary: "Archived task" },
    ]

    for (const s of sessions) {
      await client.query(
        `INSERT INTO sessions (id, status, prompt, summary, started_at, updated_at, completed_at, trigger_source)
         VALUES ($1, $2, $3, $4, $5, $5, $5, 'manual')
         ON CONFLICT (id) DO NOTHING`,
        [s.id, s.status, s.prompt, s.summary, now],
      )
    }
  } finally {
    await client.end()
  }
}

/** Clean and re-seed: truncate then insert fresh test data. */
export async function resetTestData(): Promise<void> {
  await truncateAllTables()
  await seedTestData()
}
