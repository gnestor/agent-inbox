# Inbox

Unified web app for managing emails (Gmail), Notion tasks, and Claude Code agent sessions.

## Architecture

- **Frontend**: React 19 + Vite 7 + TypeScript — UI components from `@hammies/frontend`
- **Server**: Hono + `@hono/node-server` on port 3002
- **Database**: better-sqlite3 in `data/inbox.db`
- **Sessions**: `@anthropic-ai/claude-agent-sdk` — sessions stored in `~/.claude/projects/`, interchangeable with Claude Code CLI

## Running

Always pass `--workspace` explicitly when starting the dev server:

```bash
# From workspace root
npm run inbox:dev -- --workspace ~/Github/hammies/hammies-agent

# Or directly
cd packages/inbox && npm run dev -- --workspace ~/Github/hammies/hammies-agent
```

The `--workspace` arg sets the agent's working directory for new sessions AND scopes which JSONL sessions are shown by default in the Sessions view. The server defaults to `~/Github/hammies/hammies-agent` if omitted, but always specify it explicitly to avoid confusion.

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

After implementing a feature, follow this sequence in order:

1. **Update `TODO.md`** — mark the feature `- [x]` in the relevant section
2. **Run tests** — `npm run test:ci` must pass (tsc + vitest)
3. **Commit** — stage only the files for this feature (not unrelated uncommitted changes), then commit with a subject line and body:
   ```
   feat: short description of what was added

   - Bullet summarizing key implementation detail
   - Another bullet if needed
   ```
   Use `fix:` for bug fixes, `refactor:` for refactors, `test:` for test-only changes.

## Testing

Run tests: `npm run test:run` (or `npm test` for watch mode).

**Write tests for every change or new feature** — red first, then green:

- Pure server logic (`server/lib/`) → `server/lib/__tests__/*.test.ts` (node environment)
- React hooks (`src/hooks/`) → `src/hooks/__tests__/*.test.tsx` (add `// @vitest-environment jsdom` at top)
- Tests run automatically after each file save via the PostToolUse Claude hook.

## Conventions

- Import UI components from `@hammies/frontend/components/ui`
- Import `cn()` from `@hammies/frontend/lib/utils`
- No local `src/components/ui/` — use shared package
- Server routes return JSON, errors use Hono's HTTPException
- Session streaming uses SSE via `/api/sessions/:id/stream`
