# Inbox

Unified web app for managing emails (Gmail), Notion tasks, and Claude Code agent sessions.

## Setup

```bash
# From workspace root (handled by npm run setup)
npm install

# Or directly
cd packages/inbox && npm install
```

### Environment

Copy `.env.example` and fill in credentials:

```bash
cp .env.example .env
```

Required credentials:
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Gmail OAuth
- `VAULT_SECRET` — encryption key for stored credentials

Optional:
- `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET` — Pinterest integration
- `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` — QuickBooks integration

## Development

```bash
# Start both server and client
npm run dev

# Or individually
npm run dev:server   # Hono server on port 3002
npm run dev:client   # Vite dev server on port 5175
```

The `--workspace` flag sets the agent working directory (defaults to `../agent`):

```bash
npm run dev:server -- --workspace ../agent
```

## Testing

```bash
npm run test:run     # Single run
npm test             # Watch mode
npm run test:ci      # Type check + tests
```

## Architecture

- **Frontend**: React 19 + Vite + TypeScript — UI from `@hammies/frontend`
- **Server**: Hono + `@hono/node-server` on port 3002
- **Database**: better-sqlite3 (`data/inbox.db`, gitignored)
- **Sessions**: `@anthropic-ai/claude-agent-sdk` — sessions stored in `~/.claude/projects/`

## Key Directories

```
server/           # Hono API server
  routes/         # gmail, notion, sessions, webhooks
  lib/            # credentials, gmail, notion, session-manager
  db/             # SQLite schema
src/              # React frontend
  components/     # email/, task/, session/, layout/
  hooks/          # use-emails, use-tasks, use-sessions
  api/            # Typed API client
data/             # SQLite database (gitignored)
```
