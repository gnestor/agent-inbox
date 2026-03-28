# Plugin Architecture Phases 3–8 — Implementation 1

## Progress

- [ ] 2026-03-28 03:50 — Setup: read CLAUDE.md, spec, reviewed current codebase state
  - Worktree at /Users/grant/Github/hammies/hammies-workspace/packages/inbox/.claude/worktrees/agent-a2a17ed1
  - Branch: unified-plugins
  - All 586 tests pass (52 test files)
  - No plugins/ directory yet
  - server/plugins/ has gmail-plugin.ts, notion-calendar-plugin.ts, notion-tasks-plugin.ts, notion-shared.ts
  - server/lib/ has gmail.ts, email-sanitizer.ts, email-to-markdown.ts, types/gmail-api.ts
  - src/components/email/ has EmailTab.tsx, EmailListView.tsx, EmailDetailView.tsx, EmailThread.tsx
  - src/hooks/ has use-email*.ts hooks
  - App.tsx uses COMPONENT_REGISTRY with hardcoded plugin component keys

## Acceptance Criteria (assessment after implementation)

1. Gmail consolidated in `plugins/gmail/` (built-in)
2. Core plugin in `plugins/core/` (built-in, skills-only)
3. Notion removed from built-in, workspace plugin exports three Plugin objects
4. Plugin loader supports workspace extends built-in + array exports
5. `itemToContext` on Plugin interface, implemented in Gmail
6. `cache` on PluginContext, wired in routes
7. Backfill route works
8. ALL plugin components render via PluginFrame (no static COMPONENT_REGISTRY)
9. Gmail components are self-contained iframe modules
10. Type exports at `@hammies/inbox`
11. All tests pass
12. Browser test: all tabs load, data renders, no errors

## Summary

**Status:** In Progress
