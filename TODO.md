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

## feat/new-session

- [x] Clicking New Session button from the sessions view should add a new detail view or replace the existing detail view, not just add a new panel to the tab. 

## feat/rich-session-output

- [x] Artifact iframes are capturing horizontal scrolling and shouldn't
- [x] Add edit button to artifact panel toolbar which opens a new code editor panel for the artifact code. The code editor panel has a save and close button in its toolbar. As code is edited, the artifact panel is "hot-reloaded" to reflect the changes. When the save button is pressed, the artifact's code in the session transcript is overwritten. 
- [x] For email body iframes, use the same approach to inject theme colors as we're doing for artifacts. The iframe theme should match the app's theme, even if the light/dark system theme changes.

## declarative

- [x] Refreshing any route renders the Emails tab first and then scrolls to the tab reflecting the route. 
- [x] The `/recent/...` routes be distinct tabs and not just shortcuts to existing routes. Their tab position should be relative to the other tabs in the sidebar. They should not include a list view (Sessions, Emails, etc.). Their state doesn't affect the state of other routes. This will fix this bug:
  - Selecting the Emails tab from http://localhost:5175/recent/emails/199a1aa1dba1090e/session/d1815506-51f6-42b4-90a1-0a0db3f1b30e does nothing. 
- [x] Clicking New Session button from the sessions view should add a new detail view or replace the existing detail view, not just add a new panel to the tab. This was fixed in 6b2993b489e5a902a7a52377236808dd3aae93d8 but something regressed.
- [x] Regression: Detail views belonging to a list view are not sliding in/out from the top/bottom.
- [x] Artifact editor panel is not persisted after reload.
- [x] The user's original prompt is not displayed in the session transcript. That is a bug and should be fixed.
- [x] When a user prompt involves generating an artifact, the user prompt through the artifact response are removed from the trasncript as soon as the artifact is rendered in the session transcript. After reloading the page, they're back in the transcript. I've observed this many times so it's a bug.
- [x] `sendAction` from an artifact panel is sent to the session but there is no feedback in the session transcript. After reloading the page, the updates to the session are visible. 
- [x] There is a user ("You") event in http://localhost:5175/sessions/da2c788a-c8c7-44b8-b75b-d2c261c43488 that contains the SKILL.md for claude-api.
- [x] The session transcript should be scrolled to the bottom on load.
- [x] The session detail view title is "Session" but it should be the session's title/description
- [x] Use One Dark/Light themes for syntax highlighting and app theme
- [ ] Many artifacts in sessions are missing the `body` element in the iframe
- [x] Untitled sessions display no title in the session toolbar so the user is unable to rename it. Untitled sessions should display "Untitled" in the toolbar.
- [x] Updating an artifact's code update the artifact in a panel but doesn't update the inline artifact. 
- [x] When connecting an integration in the integrations view, display a Sonner with success or failure.
- [x] Update Postgres and Gemini icons in integrations view
- [x] The transcript for http://localhost:5175/recent/sessions/75cc1e5d-2e60-4607-b7d5-9b6b90abf9d1 is vertically aligned with the bottom while http://localhost:5175/recent/sessions/c73bac2d-05dd-4a3b-b98c-362184b252f5 is vertically aligned with the top.
- [x] When selecting list items in the list view (for all tabs), the additional panel(s)/PanelSlots are not sliding in/out with the detail view panel. The detail view slides in/out and the session panel(s) appear instantly on transition in and disappear instantly on transition out.
- [x] Don't update the session summary with Claude's response. The user can manually rename the session, and if the session summary = session prompt, then the app should use the Claude API to summarize the session based on the user and agent message (don't include thinking, tool calls, etc.).
- [x] Update session transcript style to match Claude desktop ![alt text](image.png)
- [x] Render images inline
- [x] Regarding 15f1109622c97396dcd1448087a4f9d8e3f783bd, the skeleton is the session toolbar can reveal the title as soon as session presence is loaded, it doesn't need to wait for the session artifacts' postMessage

## Next

- [x] Refactor the sources (Gmail Emails, Notion Tasks, Notion Calendar) to be plugins like the Slack source plugin. Edit the plugin interface if necessary as it should be able to fully support the existing sources. The final plugin interface should be able to accomodate very simple sources (e.g. Slack) and feature-rich sources (e.g. Gmail or Github).
  - [x] Slack (User) should be the Slack integration (remove "user" from name and title)
  - [x] Remove author/assignee from tasks list view item
  - [x] The loaders for plugin list and detail views is different than other tabs (there's a "plug" icon). Use the same skeleton loaders for plugins/Slack tabs as other plugins (Gmail, Notion).
  - [x] Navigating between plugin (Slack) tabs is not the same as other tabs.
  - [ ] Plugins should support webhooks in addition to query and mutate functions
  - [ ] Plugins should be able to provide prompts/skills/workflows (e.g. Gmail plugin to fetch, update, reply/draft emails, render emails list, email thread, and reply editor, and prompt/skill/workflow to process emails)
- [x] If a recent session (in the sidebar) is archived, it should be removed from the recent sessions section of the sidebar (the sessions included here should be sessions last modified in the past x hours and where status != 'achived')
- [x] In development mode, log all session events to the console.
- [x] For the send and stop buttons in the session input, remove the background and make the foreground color match the ground CSS variable (like the other buttons).
- [x] The width of the session title editor should be the same as the session title element
- [x] The loader for the app should be a skeleton of the sidebar and list view panel vs. a "Loading..."
- [x] Session events from subagents should be distinguished from the primary agent. The event label (accordion title) is "Agent" but should be the Agent's name. See http://localhost:5175/recent/sessions/909c9f99-b4b0-4658-9ff9-7318dfd6b5a0 for examples of subagent responses. 
- [x] Render thinking content as markdown. 
- [x] Skeletons on dark mode doesn't appear to shimmer.
- [x] Should we just convert emails to markdown vs. sanitizing and sandobxing in an iframe?
- [x] The session transcript skeleton/loader is not waiting for the SSE or artifact's to callback, it's just using a timer. 
- [x] Add to integrations: Google Analytics, BigQuery, Google Search Console, Google Trends, Google Workspace.
- [x] Use user's OAuth token for Google Workspace.
- [x] The "expand" button on sesssion artifacts don't open in a new panel on mobile
- [x] When starting a new session from the sessions list view, the list item is added to the list view but it's not selected automatically.
- [x] Archived sessions are showing as complete. I restore and archive again and some are marked as (and moved to the top) while others are switch from archived to complete right away, like an optimistic update failing.
- [x] Audit use of inline styles vs. Tailwind classes
- [ ] Use prettier across hammies-workspace
- [ ] Add sort by to list view
- [ ] Migrate from SQLite to local Postgres database
- [ ] Sync qmd DB with Mac Mini, or store in Postgres
- [ ] Sync sessions with Mac Mini
- [ ] Remove the Projects filter from the sessions list view. We're only fetch session transcripts from the workspace's project folder in ~/.claude/projects now. 
- [ ] Optimistic updates for email delete/archive
- [ ] Multiple workspace support: From the account menu, the user can switch between workspaces and if they're an admin, they can manage workspaces. 
  - [ ] personal-agent for grantnestor@gmail.com
- [ ] Upload files to session
- [ ] Save artifacts in session directory
- [ ] Files panel for session, view, download, and upload files for a session, all in dedicated session directory in `sessions/{{session_id}}`
- [ ] Remove "View" from component names and update all references, including docs
- [ ] Create artifact actions (e.g. download) that can be displayed inline in a standard way and in the toolbar for an artifact panel
- [ ] Create a style/design guide for frontend and artifacts
- [ ] Open Notion links in panels vs. Notion
- [ ] Add support for slash commands?
- [ ] Add compact/clear context?
- [ ] Pin sessions? Add to folder/project?
- [ ] Plugins for source, workflows, commponents
  - [ ] Gmail plugin can provide a source/input, list and detail view components, email editor component, process email workflow, triage emails workflow
  - [ ] Notion plugin for databases (list view), pages (detail view), page editor component, skills for research?, process page workflow
- [ ] Context menu that includes toolbar actions (list view items, detail view content area, session panel body, output panel body)
- [ ] Add playwright for browser verification

## Phase 3: Workflow App (current)

- [x] Session improvements (auto-naming, inline rename, attach source to session)
- [ ] Test auto-naming end-to-end (requires ANTHROPIC_API_KEY — create session, let it complete, verify Haiku generates title)
- [x] Multi-user auth + credential proxy (AES-256-GCM vault, HTTPS MITM proxy, OAuth flows)
- [x] Integrations settings UI (connect/disconnect, workspace/user scoping)
- [x] Integration registry with env var declarations (future plugin migration)
- [x] Generic credential migration script (`npm run migrate:credentials`)
- [x] Session presence tracking (avatar stack in header, author attribution in transcript)
- [ ] Collaboration + output sharing (session sharing, output snapshots)
- [x] Rich session outputs + React artifacts (render_output tool, OutputRenderer, panel stack)
- [x] Source plugins (SourcePlugin interface, Gmail/Notion refactor, Slack plugin)
- [ ] Self-improving system + retrieval (workflow-plugin scope)
- [x] Migrate context, workflows, skills from hammies-agent to packages/agent

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
- [x] Empty state illustrations
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
- [x] Email cleaner: handle more Outlook Word quirks (e.g. `<o:p>` noise in visible content)
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
