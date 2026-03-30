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
  itemToContext?(item): string | null
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
