# Inbox

Unified web app for managing emails (Gmail), Notion tasks, and Claude Code agent sessions.

## Architecture

- **Frontend**: React 19 + Vite 7 + TypeScript — UI components from `@hammies/frontend`
- **Server**: Hono + `@hono/node-server` on port 3002
- **Database**: PostgreSQL via `pg` connection pool (configured via `DATABASE_URL` env var)
- **Sessions**: `@anthropic-ai/claude-agent-sdk` — sessions stored in `~/.claude/projects/`, interchangeable with Claude Code CLI

## Running

```bash
# From workspace root
npm run inbox:dev

# Or directly
cd packages/inbox && npm run dev
```

The `--workspace` arg (defaults to `../agent`) sets the agent's working directory for new sessions and scopes which JSONL sessions are shown in the Sessions view.

Server runs on port 3002, client on port 5175. Vite proxies `/api` to the server.

## Key Directories

```
server/           # Hono API server
  routes/         # gmail, notion, sessions, webhooks
  lib/            # credentials, gmail, notion, session-manager
  db/             # SQLite schema
src/              # React frontend
  components/     # email/, task/, session/, layout/
  hooks/          # use-emails, use-tasks, use-sessions, use-session-stream
  api/            # Typed API client
  lib/            # Formatters, utilities
  types/          # TypeScript types
data/             # SQLite database (gitignored)
```

## Auth

- Loads credentials from workspace `.env` (GOOGLE_*, NOTION_API_TOKEN, etc.)
- Claude sessions use the user's Claude subscription (ANTHROPIC_API_KEY excluded from agent env)
- Gmail: OAuth token refresh via GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN
- Notion: Bearer token via NOTION_API_TOKEN

## Feature Workflow

**IMPORTANT: These steps are mandatory after EVERY task — not optional.**

After implementing any feature, fix, or refactor, complete this sequence in order before considering the task done:

1. **Write tests** — every change needs tests. Write them before or alongside the implementation:
   - Pure server logic (`server/lib/`) → `server/lib/__tests__/*.test.ts`
   - React hooks (`src/hooks/`) → `src/hooks/__tests__/*.test.tsx`
   - Do not skip this step even for refactors that preserve the same interface.

2. **Run tests** — `npm run test:ci` must pass (tsc + vitest). Fix failures before proceeding.

3. **Update `TODO.md`** — mark completed items `- [x]` and add new items if the work introduced follow-up tasks.

4. **Update docs** — if the change affects architecture, caching, or key patterns, update the relevant file in `docs/`.

5. **Commit** — stage only files for this task, then commit:
   ```
   feat: short description

   - Key implementation detail
   - Another detail if needed
   ```
   Use `fix:` for bug fixes, `refactor:` for refactors, `test:` for test-only changes.

## Testing

### Unit tests (vitest)

Run: `npm run test:run` (or `npm test` for watch mode).

- Pure server logic (`server/lib/`) → `server/lib/__tests__/*.test.ts` (node environment)
- React hooks (`src/hooks/`) → `src/hooks/__tests__/*.test.tsx` (add `// @vitest-environment jsdom` at top)
- Tests run automatically after each file save via the PostToolUse Claude hook.

### E2E tests (Playwright)

Three tiers, each with different infrastructure requirements:

| Command | Project | Needs | Use from |
|---------|---------|-------|----------|
| `npm run test:e2e` | `mocked` | Vite client | Main package dir |
| `npm run test:e2e:api` | `api` | Hono server + DB | Worktrees OK |
| `npm run test:e2e:all` | All | Vite + Hono + DB | Main package dir |

- **`mocked`** — Browser tests with `page.route()` API mocking. Fast, deterministic. Needs the Vite client running (so monorepo symlinks must resolve).
- **`api`** — Server-only integration tests using Playwright's `request` fixture. Hit the real Hono server + DB. No browser or Vite needed — **safe to run from worktrees**.
- **`api` + `mocked`** combined via `test:e2e:all` for full coverage.

### API testing (curl)

All `/api/*` routes require the `inbox_session` cookie. To get a valid token:

```bash
psql $DATABASE_URL -t -c "SELECT token FROM auth_sessions LIMIT 1"
```

Then pass it with curl:

```bash
curl -s -X POST http://localhost:3002/api/backfill/sessions \
  -b "inbox_session=<token>"
```

### Browser testing

Use `npm run dev` from the inbox package directory to start both servers (Vite client + Hono API). The client runs on port 5175 (or next available) and proxies `/api` to the server on port 3002.

To test with Claude for Chrome MCP tools:
1. Navigate to the Vite dev URL (check terminal output for the port)
2. Use `read_console_messages` to check for errors after each interaction
3. Key flows to verify:
   - **Session list** → click a session → transcript renders with messages, tool calls, markdown
   - **New session** → click "+" → compose panel opens → type prompt → "Start Session" → optimistic message appears → streaming indicator → response renders
   - **Resume session** → type in input → Cmd+Enter → optimistic message → streaming → response
   - **Visibility toggles** → click "..." menu → toggle Messages/Tool calls/Thinking/Artifacts → transcript updates
   - **No console errors** throughout all interactions

## Worktree Development

Git worktrees get their own working tree but share the `.git` directory. Monorepo symlinks and env files need manual setup:

```bash
# After creating a worktree, from inside it:
# 1. Symlink .env (worktree doesn't have one)
ln -sf "$(git rev-parse --show-toplevel)/packages/inbox/.env" .env

# 2. Install deps (creates correct symlinks for workspace packages)
npm install

# 3. Fix @hammies/frontend if the symlink is broken
ln -sf "$(git rev-parse --show-toplevel)/packages/frontend" node_modules/@hammies/frontend
```

**What works from worktrees:**
- Unit tests (`npm run test:run`) — Node.js, no Vite
- API E2E tests (`npm run test:e2e:api`) — Hono server, no browser
- Server development (`npm run dev:server`)

**What does NOT work from worktrees:**
- Vite dev client (`npm run dev:client`) — `@hammies/frontend` symlink may break, dual-React
- Browser E2E tests (`npm run test:e2e`) — needs Vite client
- Run these from the main `packages/inbox/` directory instead.

## Conventions

- Import UI components from `@hammies/frontend/components/ui`
- Import `cn()` from `@hammies/frontend/lib/utils`
- No local `src/components/ui/` — use shared package
- Server routes return JSON, errors use Hono's HTTPException
- Session streaming uses SSE via `/api/sessions/:id/stream`

### Text sizes

Use these consistently across all UI:

- **Panel headers**: `text-sm font-semibold` (e.g. "Emails", "Integrations")
- **Section headings**: `text-sm font-semibold`
- **List item primary text** (names, titles): `text-sm font-medium`
- **Secondary/description text**: `text-xs text-muted-foreground`
- **Status text**: `text-xs`
- **Body content** (email bodies, session output): `text-sm`

Never use `text-base` or `text-lg` in panel UI — keep everything compact with `text-sm`/`text-xs`.
