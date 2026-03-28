# Plugin Architecture Phases 3–8 — Implementation 1

## Progress

- [x] 2026-03-28 03:50 — Setup: read CLAUDE.md, spec, reviewed current codebase state
  - Worktree at /Users/grant/Github/hammies/hammies-workspace/packages/inbox/.claude/worktrees/agent-a2a17ed1
  - Branch: worktree-agent-a2a17ed1
  - All 586 tests pass (52 test files)
  - No plugins/ directory yet; server/plugins/ has gmail/notion plugins
  - App.tsx uses COMPONENT_REGISTRY with hardcoded plugin component keys

- [x] 2026-03-28 — Phase 3: Gmail plugin consolidation and @plugins build system
  - Committed: 9a51451 — feat: Phase 3 — Gmail plugin consolidation and @plugins build system
  - Moved gmail code to plugins/gmail/app/lib/, plugins/gmail/app/components/
  - Added @plugins alias to vite.config.ts, vitest.config.ts, tsconfig.json, tsconfig.node.json
  - Server re-exports from new locations for backward compat
  - Created plugins/gmail/skills/process-email/SKILL.md
  - Created plugins/gmail/.claude-plugin/plugin.json

- [x] 2026-03-28 — Phase 4: Plugin loader — workspace extends built-in + array exports
  - Committed: d728c1f — feat: Phase 4 — plugin loader workspace extends built-in + array exports
  - isValidPlugin: accepts query OR hasSkills OR itemToContext
  - mergeWorkspaceOverBuiltin: workspace fields override built-in
  - Array export support: registers each entry separately
  - Sidebar activeTab fix: uses navigation state not URL

- [x] 2026-03-28 — Phase 5: Remove Notion built-in, add public type exports
  - Committed: 2ac51ea — feat: Phase 5 — remove Notion built-in, add public type exports
  - Removed Notion from server/index.ts built-in plugins
  - Created packages/agent/plugins/notion/plugin.ts (3 exports: tasks, calendar, context)
  - Added src/index.ts public type exports
  - Added exports field to package.json

- [x] 2026-03-28 — Phase 6: Core plugin + itemToContext + cache on PluginContext
  - Committed: dd92452 — feat: add core built-in plugin with shared skills and Stop hook
  - Created plugins/core/plugin.ts (skills-only, hasSkills: true)
  - Added plugin-creator, render-output, context-manager skills
  - Added Stop hook for context management
  - Added itemToContext to Plugin interface and Gmail implementation
  - Added cache to PluginContext, wired in buildPluginContext

- [x] 2026-03-28 — Phase 7: Backfill route + PostgreSQL tracking + cleanup
  - Committed: d4fc037 — feat: Phase 7 — backfill route, PostgreSQL tracking, old file cleanup
  - Added POST /api/context/backfill route with optional pluginId param
  - Added GET /api/context/backfill/state for per-plugin progress
  - Migration 003_backfill_state.sql (plugin_id, workspace_id, last_cursor, total_indexed)
  - Removed server/routes/gmail.ts, server/routes/notion.ts (now in plugins)
  - Removed server/plugins/ directory (old plugin location)
  - Added context-backfill tests (5 tests)

- [x] 2026-03-28 — Phase 8: Plugin component iframes
  - Committed: ca9eccd — feat: Phase 8 — plugin component iframes via esbuild transform
  - 8a: GET /api/:pluginId/components/:name — esbuild TSX→ESM transform with mtime cache
  - 8b: src/lib/build-plugin-component-html.ts — srcDoc HTML builder with import map, Tailwind, theme sync, postMessage bridge
  - 8c: src/components/plugin/PluginFrame.tsx — sandboxed iframe with postMessage bridge (navigate/selectItem/pushPanel/height/error)
  - 8d: Removed COMPONENT_REGISTRY from App.tsx; PluginTabSlot renders via PluginFrame or PluginView fallback
  - 8e: Created plugins/gmail/app/components/GmailTab.tsx — self-contained iframe module; updated plugin.ts to point to it
  - Simplified: removed double stat() calls, added componentCache LRU cap (100)

- [x] 2026-03-28 — Validation: npm run test:ci
  - 55 test files, 684 tests, all pass

- [x] 2026-03-28 — Rebase onto origin/main — already up to date

## Acceptance Criteria

1. [x] Gmail consolidated in `plugins/gmail/` (built-in)
2. [x] Core plugin in `plugins/core/` (built-in, skills-only)
3. [x] Notion removed from built-in, workspace plugin exports three Plugin objects
4. [x] Plugin loader supports workspace extends built-in + array exports
5. [x] `itemToContext` on Plugin interface, implemented in Gmail
6. [x] `cache` on PluginContext, wired in routes
7. [x] Backfill route works (POST /api/context/backfill + GET /api/context/backfill/state)
8. [x] ALL plugin components render via PluginFrame (no static COMPONENT_REGISTRY)
9. [x] Gmail components are self-contained iframe modules (GmailTab.tsx)
10. [x] Type exports at `@hammies/inbox`
11. [x] All tests pass (55 files, 684 tests)
12. [~] Browser test: server runs, client builds — full E2E requires prod database connection

## Summary

**Status:** Success
**Duration:** —
**Token Usage:** —
