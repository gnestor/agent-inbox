# Inbox — TODO

## Phase 1: MVP

- [x] Scaffold package (package.json, vite, tsconfig, index.html)
- [x] Server setup (Hono, SQLite, dotenv, --workspace flag)
- [x] Gmail routes (search, thread, labels, body decoding)
- [x] Notion routes (tasks query, detail with blocks, property options)
- [x] Frontend shell (sidebar nav, routing, theme)
- [x] Email views (EmailList, EmailThread)
- [x] Task views (TaskList, TaskDetail)
- [x] Session management (Agent SDK: create, resume, list, stream via SSE)
- [x] Session views (SessionTranscript, SessionView with chat input)
- [x] Start session from email/task
- [x] Session list with status badges
- [x] Shared ListItem component
- [x] Root scripts and CLAUDE.md

## Phase 2: Rich Features

- [x] Rich transcript (accordion blocks, syntax-highlighted JSON, rehype-highlight)
- [x] Combobox filters (status, tags, priority, assignee, labels, project)
- [x] Infinite scroll pagination (emails, tasks)
- [x] Notion block renderer (headings, lists, code, callout, toggle, table, divider)
- [x] HTML email rendering (sandboxed iframe with theme-matched styles)
- [x] User preferences (persisted filter/badge settings via SQLite)
- [x] Auth flow (Google Sign-In, session cookies, login page)
- [x] Header menu system (per-view dropdown for toggling badge visibility)
- [ ] Email triage (parse config.yaml, show matched rule, triage action button)
- [ ] Batch triage (process multiple emails at once)
- [x] Draft creation (create Gmail draft reply from thread view)
- [x] Mobile responsive layout (MobilePanel drawer for detail views)
- [ ] Save filtered view to nav bar (nested under Emails, Tasks, or Sessions)
- [x] Rich prompt editor (WYSIWYG markdown editor, Tiptap v3: slash commands, bubble menu, markdown shortcuts)
- [ ] Suggested prompts

## Phase 3: Webhooks + Automation + Polish

- [ ] Notion webhooks (page.content_updated → trigger sessions on task status change)
- [ ] Gmail push notifications (Pub/Sub setup, users.watch, auto-triage)
- [ ] Slack webhooks (message events → trigger sessions)
- [ ] Webhook event log (view webhook events in UI)
- [ ] Session notifications (toast on completion via Sonner)
- [ ] Keyboard shortcuts (j/k navigation, Enter to open, Escape to close)
- [ ] Session cost tracking (display usage/cost from SDKMessage data)
- [ ] Resizable column persistence (save widths to preferences)
- [ ] Batch operations (multi-select emails/tasks for bulk actions)
- [ ] Global search (search across emails, tasks, and sessions)

## UI Polish (Ongoing)

- [x] Selected state highlighting on list items (border-l-primary)
- [x] Card-based email message layout with avatar initials
- [x] Tool use blocks with human-readable summaries
- [x] Tailwind Typography for markdown prose styles
- [x] highlight.js syntax highlighting for JSON in tool blocks
- [x] Scroll-to-last-message in email thread
- [x] Dark mode support (OKLCH color system)
- [x] Loading skeleton shimmer matching actual item heights
- [ ] Empty state illustrations
- [ ] Error boundary with retry
- [ ] Transition animations between views
