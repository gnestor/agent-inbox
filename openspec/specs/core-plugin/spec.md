# Core Plugin

## Purpose

The built-in `core` plugin — a skills-only plugin (`hasSkills: true`, no `query`, no `fieldSchema`) that bundles three foundational Claude skills into every workspace: `plugin-creator` (creates new workspace plugins), `render-output` (output-rendering guidance for `create_file`/`present_files` and `render_output`), and `context-manager` (manages the workspace context index). Because the plugin has no `fieldSchema`, it doesn't appear as a sidebar tab — its only contribution is the `skills/` directory the Claude Agent SDK auto-discovers when sessions launch.

## Context

### Why core is a plugin and not a separate skills bundle
The Claude Agent SDK loads skills from plugins it discovers in the working directory; making "skills the inbox app needs everywhere" a plugin reuses the same loading mechanism that workspace plugins use. The alternative — special-casing skills in the inbox repo and shipping them via a parallel path — would create two skill-loading code paths to maintain.

### Why core has no `fieldSchema`
Skills-only plugins should not appear as data tabs. The `GET /api/plugins` route filters `p.fieldSchema?.length > 0`; without a schema, core is invisible to the sidebar but still loads its skills. The plugin loader's validation (`isValidPlugin`) explicitly accepts the `hasSkills === true` path so the plugin doesn't fail registration without `query`/`itemToContext`.

### Why three skills, not one
- `plugin-creator` activates on phrases like "create a plugin for X" / "connect X to inbox" — it walks the user through plugin scaffolding, including translating existing Claude Code skills into the `Plugin` interface.
- `render-output` is the output-rendering guidebook: when the agent has a visual artifact to surface, this skill teaches it the `create_file` + `present_files` flow (preferred for React) and the `render_output` flow (preferred for tables/charts/markdown).
- `context-manager` is the operations manual for the curated `${workspace}/context/*.md` knowledge base that the context-system pipeline produces and consumes.

Bundling them as separate skill files lets the SDK activate each only when its description matches the user's request — narrowing the agent's instruction context to what's relevant.

### Why `render-output` is preferred over inline markdown
The skill explicitly directs the agent to choose `create_file` + `present_files` for React artifacts (interactive UIs, dashboards, forms) and `render_output` for structured data. This pairs with the `session-instructions` rule "one `render_output` per artifact" and the `artifacts-and-render-tools` panel-per-output UI: the skill teaches HOW, the session instructions teach WHEN.

### Why `plugin-creator` references existing Claude Code skills
The first step in plugin creation is `ls skills/*/SKILL.md` — many integrations already have a Claude Code skill (Gorgias, Slack, etc.) with a working API client. Translating skill commands into `Plugin` methods reuses the auth + API patterns already debugged. This shortens the plugin-creation loop from "research the API" to "wrap the existing client".

### Why `hooks/hooks.json` is empty
Claude plugins can register hooks; core has no hook bindings yet but ships the manifest stub so future hook additions don't require a structural change to the plugin. The empty `hooks: {}` is a deliberate placeholder.

### What is NOT in scope
- The `Plugin` interface itself, validation, and registry merge → `plugin-system`.
- The `render_output` MCP tool implementation that skill files describe → `artifacts-and-render-tools`.
- The context curation pipeline that `context-manager` operates against → `context-system`.
- The `SESSION_INSTRUCTIONS` static string that complements these skills at session start → `session-instructions`.

## Requirements

### Plugin shape

#### Scenario: Core is a skills-only plugin with no tab
- **WHEN** the loader registers the core plugin
- **THEN** it sees `{ id: "core", name: "Core", icon: "Cog", hasSkills: true }` with no `fieldSchema`, `query`, or `itemToContext`.
- **AND** `isValidPlugin` accepts it via the `hasSkills === true` clause.
- **AND** `GET /api/plugins` excludes it from the SPA's tab list because `fieldSchema?.length > 0` is false.

#### Scenario: Core plugin is a built-in
- **WHEN** the server starts via `loadBuiltinPlugins(packages/inbox/plugins/)`
- **THEN** the core plugin is added to `builtinIds`, surviving every workspace reload.
- **AND** workspace plugins cannot replace it by ID (they would override it within a workspace registry, but the builtin entry is preserved globally).

### Skills bundle

#### Scenario: `plugin-creator` activates on plugin-creation phrasing
- **WHEN** the user says "create a plugin for X" / "add X to the inbox" / "connect X to inbox" / "build an inbox plugin for X"
- **THEN** the SDK activates `plugins/core/skills/plugin-creator/SKILL.md`.
- **AND** the skill walks the agent through: (1) check existing Claude Code skills under `skills/*/SKILL.md`, (2) translate skill commands to `Plugin` methods, (3) scaffold `{workspace}/plugins/{id}/plugin.ts`.

#### Scenario: `render-output` activates when the agent needs visual output
- **WHEN** the agent needs to render a chart, dashboard, table, or interactive UI
- **THEN** the SDK activates `plugins/core/skills/render-output/SKILL.md`.
- **AND** the skill names two flows: (1) `create_file(description, path, file_text)` then `present_files(filepaths)` — preferred for `.jsx` (React), `.html`, `.md`, `.svg`, with path convention `/mnt/user-data/outputs/<name>.<ext>`; (2) `render_output` for structured data (table/json/markdown/html/chart/react with `data: { code: "<JSX string>" }`).
- **AND** the skill specifies the update path: re-call `create_file` with the same path, then `present_files` again — only the latest version renders.

#### Scenario: `context-manager` activates for curation operations
- **WHEN** the agent needs to update or read the `${workspace}/context/*.md` knowledge base
- **THEN** the SDK activates `plugins/core/skills/context-manager/SKILL.md`.

### Hooks manifest

#### Scenario: Empty hooks manifest is a deliberate placeholder
- **WHEN** the SDK reads `plugins/core/hooks/hooks.json`
- **THEN** it sees `{ "description": "Core plugin hooks", "hooks": {} }` — no hooks active, but the manifest exists so future additions are an Edit, not a structural change.

## Technical Notes

| Concern | Location |
|---|---|
| Plugin manifest (skills-only, no fieldSchema, no query) | [plugins/core/plugin.ts](../../../plugins/core/plugin.ts) |
| Claude plugin metadata | [plugins/core/.claude-plugin/plugin.json](../../../plugins/core/.claude-plugin/plugin.json) |
| Empty hooks manifest placeholder | [plugins/core/hooks/hooks.json](../../../plugins/core/hooks/hooks.json) |
| Skill: create new workspace plugins | [plugins/core/skills/plugin-creator/SKILL.md](../../../plugins/core/skills/plugin-creator/SKILL.md) |
| Skill: output-rendering guidance | [plugins/core/skills/render-output/SKILL.md](../../../plugins/core/skills/render-output/SKILL.md) |
| Skill: context-index management | [plugins/core/skills/context-manager/SKILL.md](../../../plugins/core/skills/context-manager/SKILL.md) |
| Plugin-creator references (interface, patterns, slack example) | [plugins/core/skills/plugin-creator/references/](../../../plugins/core/skills/plugin-creator/references/) |
| Render-output references (app components, component patterns) | [plugins/core/skills/render-output/references/](../../../plugins/core/skills/render-output/references/) |

## History

- The skills bundle started inline in the inbox server's system-prompt assembly; extracted to a real plugin once `hasSkills` was added to the `Plugin` interface, removing a parallel skill-loading code path.
- `render-output`'s preference order was flipped from "render_output for everything" to "create_file + present_files for React" after sessions kept jamming JSX strings into the `react` render type with escaping bugs; the file-based path is more robust.
- `plugin-creator`'s "check skills first" step was added after the third copy of an API client appeared inline in a plugin file when the same client already existed in `skills/<service>/scripts/`.
- The empty `hooks/hooks.json` stub was kept after a discussion about deleting it — keeping it in place means a future hook addition is a one-file Edit rather than a manifest restructure.
