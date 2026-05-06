# Workspace

This doc owns workspace selection, scanning, settings, and workspace-scoped filesystem conventions.

## Context

Inbox operates over a chosen workspace directory. Sessions, plugins, context files, and background backfill jobs all depend on the active workspace. Bugs in this area can point agents at the wrong files, mix context across workspaces, or make tests depend on a developer's machine.

## Spec

### Workspace Rules

- The workspace is an explicit runtime input, not a hard-coded path.
- Server code must treat workspace paths as untrusted until resolved and validated.
- Workspace-scoped writes should be routed through domain libs, not direct writes from routes.
- Tests must use fixture workspaces such as `tests/e2e/fixtures/test-workspace`.
- UI workspace settings should call typed API routes and not infer filesystem state locally.

### Owned Behaviors

- workspace route CRUD and validation,
- workspace scanner behavior,
- workspace context file lookup,
- workspace settings UI,
- test workspace fixtures.

### Relationship To Context System

Workspace owns *where* workspace files live and how the active workspace is selected. [`context-system.md`](context-system.md) owns the raw backfill and curated context pipeline that writes inside workspace context directories.

## History

| Date | Commit | Change |
|------|--------|--------|
| 2026-04-29 | `5e413d6` | Added workspace ownership spec. |
