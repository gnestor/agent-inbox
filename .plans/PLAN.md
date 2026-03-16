# Inbox → Workflow App — Action Plan

## Vision

Evolving from an "inbox" into a **workflow app** — AI assistance that feels native, easy, and context-aware across everyday work. Agents get surrounding context, build a plan, get approval, and take action. Successful sessions become reusable **workflows**. The system self-improves over time.

## Architecture

```
packages/inbox/
├── server/              # Hono API server (Node, port 3002)
│   ├── routes/          # auth, gmail, notion, sessions, preferences, webhooks,
│   │                    # connections, workflows, shares
│   ├── lib/             # auth, gmail, notion, session-manager, credentials,
│   │                    # cache, email-sanitizer, vault, credential-proxy
│   └── db/              # SQLite schema (better-sqlite3; Postgres in Part 2)
├── src/                 # React 19 + Vite 7 frontend (port 5175)
│   ├── components/      # email/, task/, session/, layout/, shared/, settings/
│   ├── hooks/           # Data fetching, auth, preferences, streaming
│   ├── api/             # Typed API client
│   └── types/           # TypeScript types
└── data/                # SQLite DB (gitignored; local dev only)
```

### Boundaries

- **workflow-plugin**: workflow creation/execution, context querying, artifact generation, Git hooks, workflow scheduling via `create-workflow-trigger`
- **user workspace** (hammies-agent): data source skills (Slack, Shopify, Notion, etc.) and context files — usable as app source plugins
- All sources converge on a shared source plugin interface; dedicated tabs remain

---

# Part 1: Mac Mini (Current)

Goal: ship to teammates on the Mac Mini over Tailscale as fast as possible. No PostgreSQL, no workspace UI, no container isolation.

---

## Phase 0: Mac Mini Deployment *(ship tomorrow)*

### 0.1 Networking + Tailscale Serve

- [ ] Ethernet connection to Mac Mini (replace WiFi to eero extender)
- [ ] Run `tailscale serve --bg 5174` on Mac Mini
- [ ] Verify access at `https://grants-mac-mini.tail21f7c3.ts.net` from another device on the tailnet
- [ ] Verify access over cellular (expect ~615ms TTFB)

> **Architecture:** Single process — Hono API server, Vite production build (or dev server), Agent SDK session subprocesses. Tailscale Serve proxies 443 → localhost:5174 with auto-provisioned TLS. All users must be on the tailnet.

### 0.2 Auth + Environment

- [x] Google OAuth redirect URI updated to Tailscale Serve hostname
- [x] Vite config: `server.host: true`, `server.allowedHosts: true`
- [x] Claude Code set up on Mac Mini (no `CLAUDE_CODE_OAUTH_TOKEN` needed)
- [ ] Set `VAULT_SECRET` env var on Mac Mini (for AES-256-GCM credential encryption)
- [ ] Set `WORKSPACES_ROOT` env var pointing to workspaces directory

### 0.3 Workspace Directory Setup

- [ ] Create `$WORKSPACES_ROOT/` directory
- [ ] Clone hammies-agent into `$WORKSPACES_ROOT/hammies-agent/`
- [ ] Verify server discovers workspaces by reading the directory at startup

> **Convention:** Server reads `WORKSPACES_ROOT`; each subdirectory is a named workspace with a git repo. No DB table — filesystem is source of truth. Admin inspects workspaces and runs CC directly in them.

### 0.4 Server Config

- [ ] Add `WORKSPACES_ROOT` support to server startup (read directory, list workspaces)
- [ ] Set `maxTurns` on Agent SDK sessions and subagent calls
- [ ] Verify sessions can start and stream over Tailscale

### 0.5 Smoke Test

- [ ] Grant: create a session from laptop over Tailscale, verify full round-trip
- [ ] Kevin: join tailnet, access app, create a session
- [ ] Verify Gmail and Notion sources load correctly

### Performance Baselines

| Path | Median TTFB |
|------|------------|
| localhost | <1ms |
| LAN IP | ~35ms |
| Tailscale IP (HTTP, same net) | ~30ms |
| Tailscale Serve (HTTPS, same net) | ~220ms |
| Tailscale Serve (HTTPS, cellular) | ~615ms |

---

## Phase 1: Session Improvements *(easy wins, do first after deploy)*

### 1.1 Auto-naming

- [ ] After session completes, call Claude Haiku async with the transcript
- [ ] Generate title ≤60 chars, store in `sessions.summary`
- [ ] Fallback: first 80 chars of the user's initial prompt
- [ ] Show generated title in session list and session header

### 1.2 Inline Rename

- [ ] Make session title in header clickable → contentEditable or input
- [ ] On blur/enter: `PATCH /api/sessions/:id` with new title
- [ ] Server route: update `sessions.summary`

### 1.3 Attach Source to Existing Session

- [ ] Add "Add to session" action on email threads, Notion tasks, calendar events
- [ ] Show session picker (recent sessions + search)
- [ ] `POST /api/sessions/:id/attach` — injects source as a context message into the session
- [ ] Agent receives the attached context in its next turn

---

## Phase 2: Multi-User Auth + Credential Proxy

### 2.1 User Credentials Table

- [ ] Add `user_credentials` table to `server/db/schema.ts`:
  ```sql
  user_credentials (
    user_email TEXT FK → users,
    integration TEXT,
    encrypted_token TEXT,  -- AES-256-GCM, keyed by VAULT_SECRET
    refresh_token TEXT,
    scopes TEXT,
    expires_at INTEGER,
    PRIMARY KEY(user_email, integration)
  )
  ```
- [ ] Add `workspace_credentials` table:
  ```sql
  workspace_credentials (
    workspace TEXT,
    integration TEXT,
    encrypted_token TEXT,
    PRIMARY KEY(workspace, integration)
  )
  ```

### 2.2 Credential Vault (`server/lib/vault.ts`)

- [ ] Implement AES-256-GCM encrypt/decrypt using `VAULT_SECRET` env var
- [ ] `encrypt(plaintext) → ciphertext` / `decrypt(ciphertext) → plaintext`
- [ ] Write tests for encrypt/decrypt round-trip

### 2.3 Transparent Credential Proxy (`server/lib/credential-proxy.ts`)

- [ ] HTTPS proxy on random localhost port inside the Hono process
- [ ] Intercept requests to known API hosts (Notion, Shopify, Slack, GitHub)
- [ ] Look up user's encrypted token from `user_credentials` → decrypt → inject `Authorization` header
- [ ] Fall back to `workspace_credentials` if no user credential exists
- [ ] Agent subprocess receives `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, `INBOX_SESSION_TOKEN` (opaque)
- [ ] Raw OAuth tokens **never** appear in agent env or LLM context
- [ ] Handle `NODE_USE_ENV_PROXY=1` (Node 24+) or add `global-agent` dependency

### 2.4 OAuth Connection Flows (`server/routes/connections.ts`)

- [ ] `GET /auth/connect/:integration` → start OAuth flow for the current user
- [ ] `GET /auth/connect/:integration/callback` → exchange code, encrypt token, store in `user_credentials`
- [ ] `DELETE /auth/connections/:integration` → revoke token + delete row
- [ ] CLI tool for managing `workspace_credentials` (add/remove/list)

### 2.5 Integrations Settings UI (`src/components/settings/IntegrationsPage.tsx`)

- [ ] List all available integrations with connect/disconnect status
- [ ] User-scoped: "Connect" button starts OAuth flow; "Disconnect" revokes
- [ ] Workspace-scoped: shown as read-only, label "Managed by admin", no buttons
- [ ] Accessible from sidebar profile area

---

## Phase 3: Collaboration + Output Sharing

### 3.1 Session Presence

- [ ] Track connected users per session in memory (Map<sessionId, Set<userEmail>>)
- [ ] SSE broadcasts `presence` events on connect/disconnect
- [ ] Avatar stack in session header; "you" indicator on own messages

### 3.2 Session Sharing

- [ ] `session_shares` table: `(session_id, user_email, can_write)`
- [ ] Share link in session header → generates invite
- [ ] Viewers see transcript; credential scoping prevents unauthorized data access

### 3.3 Output Sharing

- [ ] `output_shares` table: `(token, output_json, created_at, created_by)`
- [ ] `POST /api/shares` → snapshot output + generate opaque token
- [ ] `GET /api/shares/:token` → public read-only view
- [ ] "Share to..." dropdown on output blocks → plugin `share` mutations (e.g., `notion.create_page`) invoked server-side

---

## Phase 4: Rich Session Outputs + React Artifacts

### 4.1 `render_output` Tool

- [ ] Define tool schema: `{ type, data, title?, panel? }`
- [ ] Types: `markdown | html | table | json | chart | file | conversation | react`
- [ ] Register tool with Agent SDK session config

### 4.2 `OutputRenderer.tsx`

- [ ] Switch on type → render appropriate component:
  - `markdown` → ReactMarkdown (existing)
  - `html` → `<iframe srcdoc sandbox>`
  - `table` → shadcn Table, sortable
  - `json` → `JsonTree.tsx`, collapsible
  - `chart` → `VegaChart.tsx`, Vega-Lite
  - `file` → File card + download link
  - `conversation` → `ConversationView.tsx` (reuse EmailThread patterns)
  - `react` → `ArtifactFrame.tsx`

### 4.3 Panel Stack Expansion

- [ ] `panel: true` outputs open as **new panels added to PanelStack** (right of session)
- [ ] Extend `PanelStack.tsx` for ephemeral artifact panels
- [ ] `SessionView.tsx` tracks open panels in local state
- [ ] Each artifact gets its own full panel (not inline sections)

### 4.4 React Artifacts (`ArtifactFrame.tsx`)

- [ ] `<iframe srcdoc sandbox="allow-scripts">` — no `allow-same-origin`
- [ ] Bundle: Babel standalone, React UMD, shadcn stubs
- [ ] Action intents via `postMessage` → parent converts to session message
- [ ] Persist artifact local state in `user_preferences` keyed `artifact:{sessionId}:{sequence}`

### 4.5 Per-Session File Directories

- [ ] Convention: `$WORKSPACES_ROOT/{workspace}/sessions/{sessionId}/{input,output}/`
- [ ] `POST /api/sessions/:id/files` (multipart) → saves to `input/`
- [ ] `render_output({ type: "file" })` links to `output/` files
- [ ] Agent receives file manifest in context
- [ ] Update workflow-plugin `CLAUDE.md` to document this pattern

---

## Phase 5: Source Plugins *(spec-first, then build)*

### 5.1 Define Plugin Spec

- [ ] Design `SourcePlugin` interface:
  ```ts
  type SourcePlugin = {
    id: string; name: string; icon: string;
    list(filters, cursor?): Promise<ListResult>;
    detail(id): Promise<DetailResult>;
    mutate?(action, payload): Promise<MutateResult>;
    subscribe?(webhookUrl): Promise<void>;
    defaultView?: "conversation" | "table" | "document" | "card";
  };
  ```

### 5.2 Refactor Gmail to Plugin Spec

- [ ] Implement `SourcePlugin` for Gmail
- [ ] Verify existing Gmail features work identically through the plugin interface

### 5.3 Refactor Notion to Plugin Spec

- [ ] Implement `SourcePlugin` for Notion
- [ ] Verify existing Notion features work identically through the plugin interface

### 5.4 Unified Sources UI

- [ ] All sources appear identically in sidebar Sources section — no "built-in vs plugin" distinction
- [ ] Dedicated Email, Tasks, Calendar tabs remain
- [ ] New plugins get their own tab when connected

### 5.5 Build Slack Plugin

- [ ] Implement `SourcePlugin` for Slack (skill already in hammies-agent)
- [ ] Priority after Slack: GitHub → Google Drive → Gorgias → Shopify

---

## Phase 6: Self-Improving System + Retrieval *(workflow-plugin)*

> Both implemented as workflow-plugin capabilities, not inbox server logic.

### 6.1 Self-Improving System

- [ ] Session errors trigger background Agent SDK session (`trigger_source: "error_recovery"`)
- [ ] Analyzes transcript, identifies failing skill/workflow/context, applies fix
- [ ] Commits fix + optionally opens PR
- [ ] Each skill has a test fixture; test suite runs after updates; failures surface as attention items

### 6.2 Retrieval (`context-backfill` workflow)

- [ ] Index sessions, emails, Notion pages into SQLite FTS (Mac Mini) or pgvector (Fly.io)
- [ ] Produce `context/{entity}.md` files as compressed, linked memory
- [ ] `search_context(query)` tool → `GET /api/context/search?q=...`

### 6.3 Workflow Scheduling

- [ ] Users ask the agent: *"schedule this workflow to run every day at 9am"*
- [ ] Agent calls `create-workflow-trigger` tool in workflow-plugin
- [ ] To cancel: ask the agent
- [ ] Sessions view: filter by `workflow_id` and optionally by trigger type

---

# Part 2: Fly.io (Future)

Migrate from Mac Mini when multi-user isolation, scale, or uptime become necessary.

### Trigger Criteria

- Onboarding users beyond Grant and Kevin
- Max subscription becomes insufficient or policy changes
- Uptime guarantees needed beyond home hosting
- Webhook-triggered workflow concurrency exceeds single-machine capacity

### Additional Work vs. Part 1

- [ ] **PostgreSQL migration** — replace `better-sqlite3` with `postgres` driver; `DATABASE_URL` env var (absent → SQLite fallback)
- [ ] **Workspace management UI** — `WorkspacesPage.tsx`: add workspace (git URL → clone), manage members, git status; `workspaces` + `workspace_members` tables
- [ ] **Fly Machines session runner** — `SessionRunner` interface: `DockerSessionRunner` (local) + `FlyMachineSessionRunner` (prod); workspace cloned on machine creation; env vars injected per-machine
- [ ] **Auth migration** — start with `CLAUDE_CODE_OAUTH_TOKEN`; migrate to `ANTHROPIC_API_KEY` when needed

### Cost Considerations

- Fly Machines: ~$0.05/hr per running machine
- API tokens: per-token billing replaces flat Max subscription
- DB: existing EC2 PostgreSQL, ~20-50ms latency from Fly

### Estimated Build Effort

| Component | Estimate |
|-----------|----------|
| Machine lifecycle (spawn/stop/cleanup) | 2-3 days |
| Communication layer (server ↔ machines) | 2-3 days |
| Credential proxy over internal network | 1-2 days |
| Git workspace hydration on machine start | 1-2 days |
| Docker-based local dev parity | 1-2 days |
| PostgreSQL migration | 1-2 days |
| Workspace management UI | 1-2 days |
| Edge cases, monitoring, cleanup | 2-3 days |
| **Total** | **~2-3 weeks** |

---

## Key Design Decisions

1. **Mac Mini first** — ship fast; defer PostgreSQL, workspace UI, and per-session container isolation to Part 2
2. **Workspaces as filesystem** — `WORKSPACES_ROOT/` directory; server reads subdirs; enables direct CC inspection
3. **Credential proxy** — transparent HTTPS interception; raw tokens never in agent env or LLM context
4. **No workspace UI on Mac Mini** — admin manages via filesystem; UI deferred to Fly.io
5. **Session outputs → panel stack** — `panel: true` opens new panels to the right; not inline sections
6. **Workflow scheduling via agent** — `create-workflow-trigger` tool; no separate scheduling UI
7. **Source plugins: spec-first** — refactor Gmail/Notion to settle the spec before building new integrations
8. **Self-improving + retrieval in workflow-plugin** — not inbox server logic
9. **Session improvements first** — easy and high-value; do before collaboration

## References

- [Agent SDK Hosting docs](https://platform.claude.com/docs/en/agent-sdk/hosting) — Fly Machines listed as sandbox provider
- [Secure Deployment](https://platform.claude.com/docs/en/agent-sdk/secure-deployment) — credential proxy pattern
- [Fly Machines API](https://fly.io/docs/machines/) — machine lifecycle management
