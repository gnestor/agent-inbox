# E2E Test Plan

## Current State

- **Playwright configured**: `playwright.config.ts` with chromium project, auth setup, screenshot-on-failure
- **Auth bypass exists**: `tests/e2e/auth.setup.ts` inserts a test user + session token directly into PostgreSQL and sets the `inbox_session` cookie — no Google OAuth needed
- **7 spec files**: navigation, session-actions, session-rename, integrations, session-lifecycle, session-visibility, error-states
- **Current limitation**: Tests use `page.route()` API mocking — they verify frontend behavior against mock data but don't exercise the real server/DB stack

## Goal

Run Playwright tests against a real dev server backed by a test PostgreSQL database, so they cover the full request → server → DB → response → UI pipeline. API-mocked tests remain as a fast suite; the real-server tests are a separate "integration" project.

## Infrastructure Required

### 1. Test Database

Create a dedicated test database that E2E tests can freely create/destroy data in.

```bash
# One-time setup (or in CI)
createdb inbox_test
DATABASE_URL=postgresql://localhost:5432/inbox_test npx tsx server/db/migrate.ts
```

**Approach**: Use the existing `initializeDatabase()` from `server/db/pool.ts` which runs all migrations. Each test suite should run in a transaction that's rolled back after the suite (or truncate tables in `beforeAll`).

### 2. Dev Server for Tests

Add a `webServer` config to `playwright.config.ts`:

```ts
webServer: {
  command: "DATABASE_URL=postgresql://localhost:5432/inbox_test npm run dev",
  port: 5175,
  reuseExistingServer: !process.env.CI,
  timeout: 30_000,
},
```

This auto-starts the dev server before tests and stops it after. In CI, it starts fresh; locally, it reuses a running server.

### 3. Test Data Seeding

Create `tests/e2e/seed.ts` that inserts baseline data:
- Test user (already done in auth.setup.ts)
- Test workspace with a known path
- A few session records with different statuses
- Sample plugin data (Gmail threads, Notion tasks) if plugins are configured

Call `seed()` from a global setup or from `auth.setup.ts` after auth.

### 4. Playwright Project Structure

```ts
// playwright.config.ts
projects: [
  { name: "setup", testMatch: /auth\.setup\.ts/ },
  {
    name: "unit",
    testMatch: /.*\.spec\.ts/,
    testIgnore: /integration\//,
    use: { storageState: "tests/e2e/.auth/user.json" },
    dependencies: ["setup"],
  },
  {
    name: "integration",
    testDir: "./tests/e2e/integration",
    use: { storageState: "tests/e2e/.auth/user.json" },
    dependencies: ["setup"],
  },
],
```

- **`unit`** (existing): API-mocked tests in `tests/e2e/`. Fast, no server needed.
- **`integration`** (new): Real-server tests in `tests/e2e/integration/`. Requires DB + dev server.

## Integration Test Spec Files

### `tests/e2e/integration/session-crud.spec.ts`
Full lifecycle against real server:
- Create a session → verify it appears in the list
- Open the session → verify transcript loads (may be empty initially)
- Rename session → verify new title persists after refresh
- Archive session → verify it disappears from active list
- Unarchive → verify it reappears

### `tests/e2e/integration/workspace-management.spec.ts`
- Load workspace list
- Switch active workspace → verify data refreshes
- Rename workspace → verify name persists

### `tests/e2e/integration/health-check.spec.ts`
- `GET /api/health` returns structured JSON with database, vault, plugins
- Verify `status: "ok"` when everything is running

### `tests/e2e/integration/api-validation.spec.ts`
- POST /api/sessions with empty body → 400 with Zod error
- POST /api/sessions with invalid JSON → 400
- PATCH /api/sessions/:id with wrong type → 400
- Verify rate limit headers are present on responses

## CI Pipeline

```yaml
# .github/workflows/e2e.yml
jobs:
  e2e:
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: inbox_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports: ["5432:5432"]
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx playwright install chromium
      - run: npm run test:e2e
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/inbox_test
          VAULT_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
```

## Scripts

Add to `package.json`:
```json
{
  "test:e2e": "npx playwright test --project=unit",
  "test:e2e:integration": "npx playwright test --project=integration",
  "test:e2e:all": "npx playwright test"
}
```

## Migration Path

1. **Phase 1** (now): Document this plan. Current mocked tests remain as-is.
2. **Phase 2**: Add `webServer` config + seed script + one integration test (health-check).
3. **Phase 3**: Add session-crud and workspace integration tests.
4. **Phase 4**: Add CI pipeline with PostgreSQL service container.
