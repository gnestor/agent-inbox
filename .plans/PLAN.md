# Inbox Package — Plan

## Context

Managing emails, Notion tasks, and Claude Code agent sessions is fragmented across Shortwave, Gmail, Notion, and the Claude Code CLI. This package creates a single web app that unifies all three, letting you browse emails/tasks, start/monitor/review agent sessions, and resume sessions — all from one interface.

## Architecture

```
packages/inbox/
├── server/              # Hono API server (Node, port 3002)
│   ├── routes/          # auth, gmail, notion, sessions, preferences, webhooks
│   ├── lib/             # auth, gmail, notion, session-manager, credentials, cache, email-sanitizer
│   └── db/              # SQLite schema (better-sqlite3, WAL mode)
├── src/                 # React 19 + Vite 7 frontend (port 5175)
│   ├── components/      # email/, task/, session/, layout/, shared/
│   ├── hooks/           # Data fetching, auth, preferences, streaming
│   ├── api/             # Typed API client
│   ├── lib/             # Formatters, utilities
│   └── types/           # TypeScript types
└── data/                # SQLite DB (gitignored)
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | React 19, Vite 7, TypeScript, React Router 7 |
| UI Components | `@hammies/frontend` (shared shadcn/ui library) |
| Server | Hono + @hono/node-server |
| DB | better-sqlite3 (WAL mode) |
| Sessions | @anthropic-ai/claude-agent-sdk |
| Auth | Google OAuth (workspace `.env` credentials) |
| Markdown | react-markdown + remark-gfm + rehype-highlight |
| Syntax highlighting | highlight.js (JSON registered) |

## API Routes

### Auth (`/api/auth/`)
- `GET /client-id` — Google OAuth client ID
- `POST /callback` — Verify Google JWT, set session cookie
- `GET /session` — Current user
- `POST /logout` — Clear session

### Gmail (`/api/gmail/`)
- `GET /messages?q=&max=&pageToken=` — Search with pagination
- `GET /threads/:id` — Full thread with decoded bodies
- `GET /labels` — List labels
- `PATCH /messages/:id/labels` — Add/remove labels
- `POST /drafts` — Create draft reply

### Notion (`/api/notion/`)
- `GET /tasks?status=&tags=&assignee=&priority=&cursor=` — Filtered list with pagination
- `GET /tasks/:id` — Task detail with blocks
- `PATCH /tasks/:id` — Update properties
- `POST /tasks` — Create task
- `GET /assignees` — List assignees
- `GET /options/:property` — Select options

### Sessions (`/api/sessions/`)
- `POST /` — Start session (with optional email/task link)
- `GET /` — List sessions (hybrid: local DB + Agent SDK discovery)
- `GET /projects` — Available workspace projects
- `GET /:id` — Session + transcript
- `GET /:id/stream` — SSE for real-time updates
- `POST /:id/resume` — Send follow-up prompt
- `POST /:id/abort` — Stop running session

### Preferences (`/api/preferences/`)
- `GET /` — User settings
- `PUT /` — Update setting

### Webhooks (`/api/webhooks/`)
- `POST /notion` — Notion integration events
- `POST /gmail` — Gmail Pub/Sub push
- `POST /slack` — Slack events

## Frontend Layout

```
┌─────────┬──────────────┬───────────────────────────┐
│ Sidebar │  List View   │      Detail View           │
│ (nav)   │  (items)     │  (thread/task/transcript)  │
│  250px  │   350px      │       flex-1               │
└─────────┴──────────────┴───────────────────────────┘
```

Resizable panels. Mobile uses drawer overlay for detail view.

## Frontend Routes

```
/                        → /inbox (redirect)
/inbox                   → EmailList + empty state
/inbox/:threadId         → EmailList + EmailThread
/tasks                   → TaskList + empty state
/tasks/:taskId           → TaskList + TaskDetail
/sessions                → SessionList + empty state
/sessions/:sessionId     → SessionList + SessionView
```

## Key Design Decisions

1. **Workspace-based auth**: Credentials loaded from `--workspace` path's `.env` file
2. **Claude subscription**: `ANTHROPIC_API_KEY` excluded from agent env so sessions use user's Claude subscription
3. **Hybrid session discovery**: Local SQLite tracks inbox-created sessions; Agent SDK discovers CLI sessions
4. **Session interchangeability**: Sessions started here can be resumed in Claude Code CLI and vice versa
5. **TTL cache**: API responses cached with pattern-based invalidation on mutations
6. **Shared UI**: All base components from `@hammies/frontend` — no local `src/components/ui/`

## Database Tables

- `sessions` — Inbox-created session metadata
- `session_messages` — Message history
- `email_task_links` — Email↔Task associations
- `processed_emails` — Email processing audit trail
- `notion_options` — Cached Notion property options
- `auth_sessions` — Active user sessions
- `user_preferences` — Per-user settings
- `api_cache` — TTL-based response cache

## Implementation Phases

### Phase 1: MVP
Browse emails + tasks, start/interact with sessions, view transcripts.

1. Scaffold package (package.json, vite, tsconfig, index.html)
2. Server setup (Hono, SQLite, dotenv, --workspace flag)
3. Gmail routes (search, thread, labels, body decoding)
4. Notion routes (tasks query, detail with blocks, property options)
5. Frontend shell (sidebar nav, routing, theme)
6. Email views (list with search/filter, thread with HTML rendering)
7. Task views (list with filters, detail with Notion block rendering)
8. Session management (Agent SDK: create, resume, list, stream via SSE)
9. Session views (transcript with markdown/code/tool blocks, chat input)
10. Start session from email/task (pre-filled prompt)
11. Session list (status badges, project filter)
12. Shared ListItem component (consistent layout across all views)
13. Root scripts and CLAUDE.md

### Phase 2: Rich Features
14. Rich transcript (accordion blocks, syntax highlighting, JSON viewer)
15. Combobox filters (status, tags, priority, assignee, labels)
16. Infinite scroll pagination
17. Notion block renderer (headings, lists, code, callout, toggle, table)
18. HTML email rendering (sandboxed iframe)
19. User preferences (persisted filter/badge settings)
20. Auth flow (Google Sign-In, session cookies)
21. Header menu system (per-view dropdown for badge toggles)
22. Email triage (parse config.yaml, matched rules, triage action)
23. Draft creation (reply from thread view)
24. Mobile responsive layout (drawer overlay for detail)

### Phase 3: Webhooks + Automation + Polish
25. Notion webhooks (page.content_updated → trigger sessions)
26. Gmail push notifications (Pub/Sub → auto-triage)
27. Slack webhooks (message events → trigger sessions)
28. Webhook event log UI
29. Session notifications (toast on completion)
30. Keyboard shortcuts (j/k navigation, Enter, Escape)
31. Session cost tracking (usage from SDKMessage)
32. Resizable columns (drag handles)
33. Batch operations (multi-select emails/tasks)
34. Search across all views (global search)
