# Inbox — TODO

## Phase 1: MVP

- [x] Scaffold package (package.json, vite, tsconfig, index.html)
- [x] Server setup (Hono, SQLite, dotenv, --workspace flag)
- [x] Gmail routes (search, thread, labels, body decoding)
- [x] Notion routes (tasks query, detail with blocks, property options)
- [x] Frontend shell (sidebar nav, routing, theme)
- [x] Email views (EmailList, EmailThread)
- [x] Task views (TaskList, TaskDetail)
- [x] Calendar views (CalendarList, CalendarDetail) — Notion Calendar database (Date, Status, Tags, Assignee)
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
- [x] Server-side email body cleaning (strip quoted replies, Outlook/Apple Mail headers, Chinese headers, app signatures before caching)
- [x] User preferences (persisted filter/badge settings via SQLite)
- [x] Auth flow (Google Sign-In, session cookies, login page)
- [x] Header menu system (per-view dropdown for toggling badge visibility)
- [ ] Email triage (parse config.yaml, show matched rule, triage action button)
- [ ] Batch triage (process multiple emails at once)
- [x] Draft creation (create Gmail draft reply from thread view)
- [x] Email actions (archive, delete, star, important via thread label modification + reply composer with Send/Save Draft)
- [x] Task/Calendar property editing (inline Select/Combobox for status, priority, tags + date picker for calendar)
- [x] Gmail write endpoints (sendMessage, trashThread, modifyThreadLabels)
- [x] Notion calendar PATCH endpoint (reuses updateTaskProperties for calendar items)
- [x] Mobile responsive layout (spatial grid: overlay panels, drag-to-dismiss/forward, vertical tab swipe)
- [ ] Save filtered view to nav bar (nested under Emails, Tasks, or Sessions)
- [x] Rich prompt editor (WYSIWYG markdown editor, Tiptap v3: slash commands, bubble menu, markdown shortcuts)
- [x] Prompt templates (save/load named templates in new-session panel, persisted to preferences)
- [x] AskUserQuestion panels (agent pauses mid-session, frontend shows interactive form, answers injected as tool result via canUseTool + pending Promise)
- [x] Auto-start sessions from detail view (skip ComposePanel; fires createSession immediately with <ide_opened_file> prompt including thread/task ID)
- [x] Workflow UI components (ContextPanel renders <inbox-context> XML; InboxResultPanel renders <inbox-result> with draft editor + Send or task + Mark Complete)
- [x] Open Session button (email/task detail shows "Open Session" instead of "Start Session" when a linked session already exists, using linked_email_thread_id/linked_task_id)
- [x] Skill context blocks in transcript (user-role "Base directory for this skill:" messages rendered as collapsed accordion with Wrench icon)
- [ ] Suggested prompts
- [ ] Notion body editing (replace NotionBlockRenderer with TipTap RichTextEditor + 15s idle auto-save + updatePageBlocks endpoint + markdown↔Notion blocks conversion)
- [ ] Link insertion UI (replace window.prompt in bubble menu with inline popover)
- [ ] Prompt template categories (group templates by type: email, task, general)
- [x] Virtual scrolling (TanStack Virtual for all list views and session transcript; useAnimationFrameWithResizeObserver:true prevents infinite loops from accordion animations firing ResizeObserver synchronously during React commit phase)
- [x] Fix "Maximum update depth exceeded" cascade in SessionTranscript (React 19 flushSpawnedWork + TanStack Virtual measureElement ref; replaced base-ui Accordion with local useState toggle; replaced useVirtualizer with useVirtualizerSafe wrapping resize onChange in startTransition)
- [x] TanStack Query + IndexedDB persistence (replaces localStorage list-cache and server-side SQLite API caches; `useInfiniteQuery` for emails/tasks, `useQuery` for sessions/detail/thread; persisted to IndexedDB via `idb-keyval` for instant reload; `staleTime: Infinity` + `onSuccess` invalidation for page-load refresh; `useMutation` for session create/resume/abort with cache invalidation)
- [x] Persistent app state (navigation state, open panels, per-tab selection saved to localStorage)
- [x] Refresh on focus (all list hooks refetch when window regains focus)
- [x] IDE context display in session transcript (file opens + line selections shown as file chips on user messages)
- [ ] Filter session transcripts
  - [ ] Details level (User/agent messages, thinking, tool calls, etc.)
  - [ ] Date
  - [ ] Query?

## Phase 3: Workflow App (current)

- [x] Session improvements (auto-naming, inline rename, attach source to session)
- [ ] Test auto-naming end-to-end (requires ANTHROPIC_API_KEY — create session, let it complete, verify Haiku generates title)
- [x] Multi-user auth + credential proxy (AES-256-GCM vault, HTTPS MITM proxy, OAuth flows)
- [x] Integrations settings UI (connect/disconnect, workspace/user scoping)
- [x] Integration registry with env var declarations (future plugin migration)
- [x] Generic credential migration script (`npm run migrate:credentials`)
- [x] Session presence tracking (avatar stack in header, author attribution in transcript)
- [ ] Collaboration + output sharing (session sharing, output snapshots)
- [ ] Rich session outputs + React artifacts (render_output tool, OutputRenderer, panel stack)
- [ ] Source plugins (SourcePlugin interface, Gmail/Notion refactor, Slack plugin)
- [ ] Self-improving system + retrieval (workflow-plugin scope)
- [ ] Migrate context, workflows, skills from hammies-agent to packages/agent

## Phase 4: Webhooks + Automation + Polish

- [ ] Notion webhooks (page.content_updated → trigger sessions on task status change)
- [ ] Gmail push notifications (Pub/Sub setup, users.watch, auto-triage)
- [ ] Slack webhooks (message events → trigger sessions)
- [ ] Webhook event log (view webhook events in UI)
- [ ] Session notifications (toast on completion via Sonner)
- [ ] Keyboard shortcuts (j/k navigation, Enter to open, Escape to close)
- [ ] Session cost tracking (display usage/cost from SDKMessage data)
- [ ] Resizable column persistence (save widths to preferences)
- [ ] Batch operations (multi-select emails/tasks for bulk actions)
- [ ] Assignee editing (requires person name→UUID mapping from Notion API for people property updates)
- [ ] Labels management UI (Combobox multi-select for Gmail label add/remove on email threads)
- [ ] Global search (search across emails, tasks, and sessions)

## UI Polish (Ongoing)

- [x] Selected state highlighting on list items (border-l-primary)
- [x] Card-based email message layout with avatar initials
- [x] Tool use blocks with human-readable summaries
- [x] Tailwind Typography for markdown prose styles
- [x] Light mode visual hierarchy: white body, off-white panels/sidebar (bg-card = oklch(0.985))
- [x] Syntax highlighting: github.css base (light) + .dark .hljs-* overrides (dark) — keys vs strings use different colors per GitHub theme
- [x] Scroll-to-last-message in email thread
- [x] Dark mode support (OKLCH color system)
- [x] Loading skeleton shimmer matching actual item heights
- [x] Transition animations between views (tab switch vertical slide, item switch vertical slide, overlay horizontal spring)
- [x] Disable zoom on mobile (touch-action: pan-x pan-y)
- [x] Text selection disabled outside content areas on mobile (user-select: none with .prose/.notion-content/.selectable-content exceptions)
- [x] Skip detail slide-in animation on tab switch (skipEntrance prop)
- [x] Floating panel card styling (rounded-lg shadow ring-1 ring-sidebar-border — matches shadcn floating sidebar variant)
- [x] Optimistic updates for email star/important (instant UI feedback, rollback on error)
- [x] Properties popover in task/calendar detail (two-column grid layout with inline editable controls)
- [x] Streamlined detail headers (replaced dropdown menus with direct action buttons, native tooltips, Sparkles session icon)
- [x] Removed details accordion from session/task/calendar detail views (cleaner layout)
- [x] Bold markdown headings (font-weight 700 for prose and Notion headings)
- [ ] Empty state illustrations
- [ ] Error boundary with retry

## Performance (Ongoing)

- [x] Gmail metadataHeaders fix (repeated query params instead of comma-separated)
- [x] Session list optimization (head/tail file reading instead of full parse — 6s → 5ms)
- [x] Session list caching (moved to TanStack Query; previously server-side staleWhileRevalidate)
- [x] Session transcript caching (moved to TanStack Query; previously server-side staleWhileRevalidate)
- [x] findAgentSession workspace-first lookup (skip scanning all dirs)
- [x] Virtualizer-based infinite scroll (replaces IntersectionObserver sentinel, triggers 12 rows before end)
- [x] Gmail rate limit fix: switch email list from messages API to threads API with format=metadata (no body fetching for list view) + batch concurrent requests (max 5 at a time, was Promise.all on all N)
- [x] Gmail incremental sync: store historyId after each full fetch, use History API on refresh to only re-fetch changed threads (avoids full re-scan on cache expiry)
- [x] Search debounce (400ms) — was firing one API request per keystroke
- [x] Session message deduplication on SSE reconnect (seenSequences ref prevents replaying already-seen sequence numbers)
- [x] User prompt persistence in session transcript (resumeSessionQuery saves the user's message to DB + broadcasts before starting agent query)
- [x] CLAUDECODE env exclusion (prevents nested Claude Code sessions from detecting they're inside another CC session)
- [ ] Email cleaner: handle more Outlook Word quirks (e.g. `<o:p>` noise in visible content)
- [x] Email cleaner: test coverage (vitest unit tests for each pattern with HTML fixtures)
- [x] Bug fixes: iframe XSS (sandbox allow-scripts removed), session stream state reset on navigation, statusOverride reset on sessionId change, email-cleaner index-0 match, GET /sessions/:id missing project field, Notion block pagination
- [x] Session panel UX: X close button on session view; hide Start Session when session panel is open; auto-scroll desktop panel stack to newly opened panel (but not when switching items — session state is pre-existing)
- [x] Panel group outer scroll suppression: ProseMirror's scrollRectIntoView walks all ancestors; suppressed via handleScrollToSelection:()=>true in RichTextEditor editorProps so setContent doesn't jump the overflow-x-auto panel group horizontally
- [x] Sessions list staleness fix: refetchOnMount:true override in useSessions and session detail query (staleTime:Infinity + refetchOnMount:false globals don't refetch after invalidation)
- [ ] Virtualize EmailThread (low priority — typically <20 messages per thread)
- [x] Key-scoped preference subscriptions (Map<key, Set> — toggling one pref re-renders only that key's subscribers)
- [x] Stabilize loadMore callback (ref-based guard, removes loadingMore from useCallback deps)
- [x] ListItem React.memo with structural badge comparator (skips onClick; re-renders only when title/subtitle/timestamp/isSelected/badges change)
- [x] Deferred tab fetching (AnimatePresence mounts only active tab; hasBeenActive ref keeps data alive after switching away)
- [ ] Sessions infinite scroll (useSessions has no cursor/pagination — currently loads all sessions)
- [ ] Remove use-swipe.ts (replaced by Framer Motion drag controls; only reference is its own test file)
