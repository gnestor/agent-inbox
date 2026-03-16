# Commit History by Phase

Commits from `ded6f61` (first Phase 1 commit) through `f23e31f` (HEAD).

## Branches

| Branch | Commit | Description |
|--------|--------|-------------|
| `phase-1` | `602675e` | Last commit before Phase 2 work begins |
| `phase-2` | `0571a65` | Last commit before Phase 2.5A work begins |

## Commits (oldest → newest)

| Commit | Message | Phase |
|--------|---------|-------|
| `ded6f61` | feat: add title-generator module for session auto-naming | **1.1** Auto-naming |
| `4433d9c` | feat: wire auto-naming into session completion lifecycle | **1.1** Auto-naming |
| `05d8809` | feat: inline editable session title (PATCH route + UI) | **1.2** Inline Rename |
| `9226818` | feat: attach source to session (POST route + API client + hooks) | **1.3** Attach Source |
| `7124ab2` | feat: AttachToSessionMenu + transcript rendering + source integrations | **1.3** Attach Source |
| `37eec1b` | fix: replace AttachToSessionMenu with SessionActionMenu | **1.3** Attach Source |
| `b53781e` | fix: use server-side FTS for session search in SessionActionMenu | **1.3** Attach Source |
| `242d2bc` | fix: allow renaming agent-only sessions by importing to DB first | **1.2** Inline Rename |
| `1f973aa` | fix: import agent sessions as 'complete' not 'running' on rename | **1.2** Inline Rename |
| `602675e` | test: add session rename + import tests (15 tests) | **1.2** Inline Rename |
| `3b99709` | feat: add user_credentials and workspace_credentials tables | **2.1** User Credentials |
| `974cd31` | feat: vault encryption module with AES-256-GCM + credential CRUD | **2.2** Vault |
| `440399c` | feat: add self-signed CA generation for credential proxy | **2.3** Credential Proxy |
| `fd1eff4` | feat: add HTTPS credential proxy with MITM for known API hosts | **2.3** Credential Proxy |
| `78f2a3d` | feat: wire credential proxy into session manager | **2.3** Credential Proxy |
| `b992b6a` | feat: add integration registry | **2.4** OAuth Flows |
| `0db0bd4` | feat: add connection routes for OAuth + credential management | **2.4** OAuth Flows |
| `37bd93d` | feat: add typed user context to auth middleware | **2.4** OAuth Flows |
| `616080f` | feat: add connections API client + hook | **2.5** Integrations UI |
| `9cbc479` | feat: add IntegrationCard + IntegrationsPage components | **2.5** Integrations UI |
| `8f2aab7` | feat: add settings route + sidebar navigation | **2.5** Integrations UI |
| `a0ab603` | feat: add VAULT_SECRET validation + .env.example | **2.2** Vault |
| `0c23a4b` | feat: add credential migration script (env → vault) | **2.4** OAuth Flows |
| `00c8bff` | chore: move Notion, Slack, GitHub to workspace scope (API key) | **2.4** OAuth Flows |
| `f12791d` | fix: use workspace basename for credential lookup | **2.4** OAuth Flows |
| `f33168a` | feat: expand integration registry and migration to cover all workspace services | **2.4** OAuth Flows |
| `a3fb94d` | feat: integration registry with envVars, generic migration, all data sources | **2.4** OAuth Flows |
| `38ea6fe` | feat: simplify integration cards, update icons, add docs | **2.5** Integrations UI |
| `225dac1` | fix: move "Managed by admin" badge to right side of integration card | **2.5** Integrations UI |
| `ca1b671` | fix: move Pinterest + QuickBooks to workspace scope | **2.4** OAuth Flows |
| `6db2bcf` | fix: restore Pinterest + QuickBooks as user-scoped OAuth | **2.4** OAuth Flows |
| `fb5629c` | feat: derive workspace name from git repo name | **0.3** Workspace Setup |
| `907ed49` | fix: Pinterest OAuth token exchange + display name in success message | **2.4** OAuth Flows |
| `b290c89` | feat: render Integrations page inside PanelStack | **2.5** Integrations UI |
| `f2ed54a` | fix: render Integrations in a PANEL_CARD like other list views | **2.5** Integrations UI |
| `454a501` | fix: allow tab navigation from settings/plugin routes | **2.5** Integrations UI |
| `c309b7d` | fix: imported sessions fall back to JSONL transcript for messages | **1.3** Attach Source |
| `4e1af25` | chore: add auto-naming e2e test to TODO | **1.1** Auto-naming |
| `e22fe25` | test: add Playwright e2e test suite | **misc** Testing |
| `6e0294f` | fix: session list matches both workspace name and dir basename | **1** Session fixes |
| `58d06e4` | fix: select all text when clicking session title to rename | **1.2** Inline Rename |
| `2ea1089` | fix: use ref callback for focus+select on rename input | **1.2** Inline Rename |
| `cc001e9` | fix: fixed-height session list rows, fallback title | **1** Session fixes |
| `9b9f908` | fix: use autoFocus+onFocus for rename select-all | **1.2** Inline Rename |
| `c14d514` | fix: migrate all list views to useVirtualizerSafe | **misc** UI fix |
| `20b2426` | chore: test coverage | **misc** Testing |
| `11d9b9c` | Update .env.example with OAuth + vault placeholders | **2.2** Vault |
| `5c01393` | Update primary workspace path | **0** Config |
| `ad8aa8b` | Update PLAN.md | **misc** Planning |
| `c17a8dc` | Update database | **misc** DB |
| `f565a50` | fix: use onClick instead of onSelect for New Session menu item | **misc** UI fix |
| `63253cb` | fix: integrations view on mobile | **2.5** Integrations UI |
| `07a6ce5` | fix: update icons on integrations view | **2.5** Integrations UI |
| `c3e1a15` | fix: update text size on integrations view | **2.5** Integrations UI |
| `0571a65` | Update .gitignore | **misc** Config |
| `f483a26` | feat: add navigation type definitions (NavigationState, TabState, PanelState) | **2.5A** Nav Core |
| `7cb5893` | refactor: extract navigation constants from PanelStack | **2.5A** Nav Core |
| `cb7164c` | feat: add navigation storage (IndexedDB persistence + localStorage migration) | **2.5A** Nav Core |
| `f602cd8` | feat: add NavigationProvider + useNavigation hook with state management | **2.5A** Nav Core |
| `c759f54` | feat: add Panel container component | **2.5A** Nav Core |
| `d5d760b` | feat: add PanelSlot AnimatePresence wrapper | **2.5A** Nav Core |
| `805bfe5` | feat: add Tab component with scroll management | **2.5A** Nav Core |
| `5a2a3b9` | feat: add PanelContent placeholder | **2.5A** Nav Core |
| `8dac44d` | feat: add navigation component barrel export | **2.5A** Nav Core |
| `1fca678` | feat: add listRole to FieldDef for schema-driven list rendering | **2.5B** ListView/DetailView |
| `eb8daaf` | feat: add field-schema helpers (extract title/badges/filters from FieldDef) | **2.5B** ListView/DetailView |
| `12e6940` | feat: add schema-driven FilterPopover component | **2.5B** ListView/DetailView |
| `356b5be` | feat: add schema-driven ListView component | **2.5B** ListView/DetailView |
| `d1838d5` | feat: add DetailView wrapper component | **2.5B** ListView/DetailView |
| `fd6a93b` | test: add schema rendering tests for email and task field schemas | **2.5B** ListView/DetailView |
| `84d812a` | feat: add SessionListView using schema-driven ListView | **2.5C** Tab Migrations |
| `80784f6` | feat: add SessionTab using new navigation components | **2.5C** Tab Migrations |
| `4a2373f` | feat: wire PanelContent to session and settings components | **2.5C** Tab Migrations |
| `aea3e3d` | feat: add NavigationProvider wrapper to App | **2.5C** Tab Migrations |
| `33142fa` | feat: add EmailListView using schema-driven ListView | **2.5C** Tab Migrations |
| `bf9450a` | feat: add EmailDetailView using DetailView wrapper | **2.5C** Tab Migrations |
| `f33585d` | feat: add EmailTab using new navigation components | **2.5C** Tab Migrations |
| `7db81ad` | feat: add TaskListView + TaskTab using new navigation | **2.5C** Tab Migrations |
| `78691c0` | feat: add CalendarListView + CalendarTab using new navigation | **2.5C** Tab Migrations |
| `7cbc50e` | feat: verify settings panel in PanelContent | **2.5C** Tab Migrations |
| `287f8cc` | feat: switch sidebar navigation from useSpatialNav to useNavigation | **2.5C** Tab Migrations |
| `898fa74` | feat: replace PanelStack with tab-based navigation | **2.5C** Tab Migrations |
| `112d9f5` | fix: boolean badges show field label not "true", Tab switchover | **2.5C** Tab Migrations |
| `a6d1948` | fix: detail panels now visible — PanelSlot width + scroll-into-view | **2.5C** Tab Migrations |
| `751131b` | fix: skip tab animation on initial page load | **2.5C** Tab Migrations |
| `fd6b830` | fix: session detail renders SessionView, hide project as subtitle | **2.5C** Tab Migrations |
| `51ec89e` | fix: replace useSpatialNav with useNavigation in SessionView | **2.5C** Tab Migrations |
| `6f13299` | feat: wire real EmailThread/TaskDetail/CalendarDetail into new navigation | **2.5C** Tab Migrations |
| `dbb8f1f` | refactor: remove old PanelStack navigation system | **2.5C** Tab Migrations |
| `d3a842e` | feat: CSS transform tab transitions + navigation fixes | **2.5C** Tab Migrations |
| `826bf3a` | chore: user edits (UI polish, linter fixes, plan docs) | **2.5** misc polish |
| `b54e0a9` | feat: unified SlotStack for tab + detail panel transitions | **2.5C** Tab Migrations |
| `eeaf826` | feat: mobile navigation — scroll-snap tabs, full-screen panels | **2.5C** Tab Migrations |
| `6be20d4` | feat: use per-user Google credentials for Gmail API calls | **2.3** Credential Proxy |
| `404333d` | fix: prevent mobile ScrollSnapStack from firing onSnapChange on init | **2.5C** Tab Migrations |
| `93862ab` | fix: set initial scroll position via ref callback (before paint) | **2.5C** Tab Migrations |
| `b4269e3` | fix: use TransformStack for all vertical transitions (tabs + items) | **2.5C** Tab Migrations |
| `dde2ecd` | fix: replace bidirectional URL↔state sync with direct navigation | **2.5C** Tab Migrations |
| `4bd7078` | fix: prevent draft reply from leaking across email threads | **misc** Bug fix |
| `8f960ae` | fix: use scrollTo instead of scrollIntoView for panel navigation | **2.5C** Tab Migrations |
| `326203c` | fix: remove scroll-snap from mobile panels, defer scroll to next frame | **2.5C** Tab Migrations |
| `f23e31f` | fix: mobile navigation | **2.5C** Tab Migrations |

## Summary

| Phase | Commits | Description |
|-------|---------|-------------|
| **0** | 2 | Workspace setup & config |
| **1.1** | 3 | Session auto-naming |
| **1.2** | 6 | Inline rename |
| **1.3** | 4 | Attach source to session |
| **2.1** | 1 | Credentials tables |
| **2.2** | 3 | Vault encryption |
| **2.3** | 4 | Credential proxy |
| **2.4** | 9 | OAuth flows & integration registry |
| **2.5 UI** | 9 | Integrations settings UI |
| **2.5A** | 8 | Navigation core (types, provider, storage, components) |
| **2.5B** | 6 | Schema-driven ListView + DetailView |
| **2.5C** | 24 | Tab migrations + PanelStack removal + mobile nav |
| **misc** | 8 | Testing, config, bug fixes, planning |
