# Plugin System

The Inbox app uses a unified plugin architecture for all data sources. Gmail, Notion, Slack, Gorgias, and any external integration implement the same `Plugin` interface. The server auto-generates REST endpoints, the client renders sidebar tabs and list/detail views, and sessions can link to any plugin's items.

## Architecture

```
Built-in plugins (packages/inbox/plugins/)     Workspace plugins ({workspace}/plugins/)
├── gmail/                                      ├── notion/
│   ├── plugin.ts (data source)                 │   ├── plugin.ts (exports [tasks, calendar])
│   ├── app/ (components, hooks, api)           │   ├── lib/notion.ts
│   └── skills/ (process-email)                 │   └── skills/ (process-task)
├── core/                                       ├── slack/
│   └── skills/ (plugin-creator,                ├── gorgias/
│       render-output, context-manager)         ├── context/
└──                                             └── triage/
```

## Plugin Interface

```typescript
interface Plugin {
  id: string              // API routes, tab IDs
  name: string            // Sidebar display name
  icon: string            // Lucide icon name
  emoji?: string          // Emoji fallback
  hasSkills?: boolean     // Skills-only (no tab)

  // Data source (optional for skills-only)
  query?(filters, cursor, ctx): Promise<QueryResult>
  mutate?(id, action, payload, ctx): Promise<unknown>
  getItem?(id, ctx): Promise<PluginItem | null>
  querySubItems?(itemId, filters, cursor, ctx): Promise<QueryResult>

  // UI configuration
  fieldSchema?: FieldDef[]          // No fieldSchema = no tab
  detailSchema?: WidgetDef[]        // Action buttons
  components?: { tab?; detail? }    // Custom iframe components
  filterOptions?: Record<string, () => Promise<string[]>>

  // Server extensions
  routes?(hono, helpers): void      // Custom API routes

  // Context system (see docs/context-system.md for the full pipeline)
  itemToContext?(item): string | null      // → raw stub markdown for context/{id}/{itemId}.md
  backfillDir?: string                      // override default `context/{id}/` (e.g. `backfill-cache/{id}/` for non-indexed stubs)
  extractEntities?(item): Entity[]          // → seed entities (person, domain, folder, etc.) for source_entities
  curationPrompt?(files: string[]): string | null  // legacy per-source curation — disabled, kept for reference
  curationBatchTokens?: number              // legacy batch token budget — unused
}
```

## Loading

1. `loadBuiltinPlugins()` — scans `packages/inbox/plugins/*/plugin.ts`, registers as built-in
2. `loadPlugins(path, wsId)` — scans `{workspace}/plugins/*/plugin.ts`
3. Array exports supported: `export default [plugin1, plugin2]`
4. Validation: needs `id` + (`query` or `hasSkills` or `itemToContext`)

## REST Routes (auto-generated)

| Method | Path | Maps to |
|--------|------|---------|
| GET | `/api/plugins` | List all plugins with fieldSchema |
| GET | `/api/:id/items` | `plugin.query()` |
| GET | `/api/:id/items/:itemId` | `plugin.getItem()` |
| GET | `/api/:id/items/:itemId/subitems` | `plugin.querySubItems()` |
| POST | `/api/:id/items/:itemId/mutate` | `plugin.mutate()` |
| GET | `/api/:id/fields/:fieldId/options` | `plugin.filterOptions[]()` |
| GET | `/api/:id/components/:name` | esbuild TSX → ESM |

## Component Rendering (Iframes)

Plugins declare `components: { detail: "ComponentName" }`. The server reads `app/components/ComponentName.tsx`, esbuild transforms to ESM, and `PluginFrame` renders it in a sandboxed iframe with React + shadcn import map, theme sync, and postMessage bridge.

## Sidebar

- Tabs rendered dynamically from loaded plugins
- Drag-to-reorder with order persisted in `user_preferences`
- Icons: Lucide icon from `plugin.icon` with emoji fallback
- Active tab highlighted via `data-active` attribute for instant scroll feedback

## Caching

- **Client**: React Query with PersistQueryClientProvider (IndexedDB)
- **Server**: PostgreSQL `api_cache` table with TTL
- 5min staleTime — cached data renders instantly, refetch in background

## Session Linking

Sessions link to plugin items via `linked_source_type` (plugin ID) and `linked_source_id` (item ID). The sidebar shows recent sessions with linked item titles fetched via `getPluginItem()`.

## Skills

Each plugin can provide Claude Code skills in a `skills/` directory:
- `process-*` skills handle items from the plugin's data source
- Skills are auto-discovered by Claude Code from `.claude-plugin/plugin.json`
- Core plugin provides: plugin-creator, render-output, context-manager

## Context System Hooks

Plugins participate in the workspace context system through three optional methods. Full pipeline in [`context-system.md`](context-system.md); plugin-author quick reference:

### `itemToContext(item) → string | null`

Convert one item to a raw stub. Frontmatter MUST include enough metadata for downstream stages to work:

- Conventional fields: `type`, `<plugin>-id`, `subject`/`title`, `from`, `date`
- Plugin-specific: e.g. Drive's `folder-path: [Hammies, Production, 2019]`
- Body content: cleaned text — Stage 2 (body-extractor) will further compress for noisy sources

Return `null` to **drop the item entirely**. This is the plugin's chance to gate noise (auto-replies, non-business categories) before stubs hit disk. Once written, the body extractor can clean but not skip.

### `extractEntities(item) → Entity[]`

Return seed entities scoped to what this source surfaces. The `Entity` type is `{ type: string, value: string }` — type is free-form (`person`, `company`, `domain`, `folder`, `channel`, `database`, `skill`, etc.), value gets canonicalized by `entity-extractor.ts`.

Reuse the workspace filter helpers from [`packages/agent/plugins/workspace-filters.ts`](../../agent/plugins/workspace-filters.ts):

- `isWorkspaceSelfPerson(name)` — drop the workspace owner
- `isAutomatedSender(email)` — drop `noreply@`, `notifications@`, etc.
- `isPromotionalDomain(domain)` — drop `em.*`, `news.*`, etc.
- `isPersonalEmailDomain(domain)` — drop `gmail.com`, `yahoo.com`, etc. (the matching `person:<email>` is the right unit)
- `isGenericFolder(name)` — drop `archive`, `invoices`, `clicks`, etc.

If a plugin doesn't implement this, the system falls back to a generic regex scan of the stub's frontmatter (emails + `folder-path`).

### `backfillDir`

By default, raw stubs go to `{workspace}/context/{plugin.id}/`, which is qmd-indexed. For sources where the body content is binary, huge, or otherwise pollutes search (Drive being the canonical case), set `backfillDir: "backfill-cache/{plugin.id}/"` to write outside the index. Curated pages then link with `../backfill-cache/...` (the `../` is required and a common bug source for the curation agent).
