# Plugin Interface Reference

Source: `packages/inbox/src/types/plugin.ts`

## Plugin

```typescript
interface Plugin {
  /** Unique slug — used in API routes, tab IDs, and session linking */
  id: string
  /** Display name shown in the sidebar */
  name: string
  /** Lucide icon name (e.g. "MessageSquare", "Github") */
  icon: string
  /** Emoji for sidebar display (falls back to 🔌 if neither icon nor emoji provided) */
  emoji?: string
  /** Custom React components — omit for generic PluginView rendering */
  components?: PluginComponents
  /** Auth requirements — client shows connection prompts when not connected */
  auth?: { integrationId: string; scope: "user" | "workspace" }

  /** Fetch a page of items. Filters match FieldDef.id where filterable is true. */
  query(filters: Record<string, string>, cursor?: string, ctx?: PluginContext): Promise<QueryResult>

  /** Perform a mutation. Actions are plugin-defined strings. */
  mutate(id: string, action: string, payload?: unknown, ctx?: PluginContext): Promise<unknown>

  /** Per-action Zod schemas for runtime payload validation (optional) */
  actionSchemas?: Record<string, ZodType>

  /** Combined schema for filter UI, list badges, and detail view layout */
  fieldSchema: FieldDef[]

  /** Custom detail widget tree (auto-generated from fieldSchema if omitted) */
  detailSchema?: WidgetDef[]

  /** Sub-item query (e.g. messages within a channel). Renders scrollable list instead of widget tree. */
  querySubItems?(itemId: string, filters: Record<string, string>, cursor?: string, ctx?: PluginContext): Promise<QueryResult>

  /** Fetch a single item with full detail */
  getItem?(id: string, ctx?: PluginContext): Promise<PluginItem | null>

  /** Dynamic filter option fetchers. Keys are field IDs. */
  filterOptions?: Record<string, (ctx?: PluginContext) => Promise<string[]>>

  /** Register custom Hono routes under /api/{pluginId}/ */
  routes?(hono: Hono, helpers: { getContext: (c: unknown) => PluginContext }): void
}
```

## PluginContext

Passed to every data method by the server. Contains the authenticated user's info and credential resolver.

```typescript
interface PluginContext {
  userEmail: string
  /** Resolve a credential — per-user OAuth or workspace API key */
  getCredential(integration: string): Promise<string | null>
}
```

Simple plugins (workspace API key) ignore ctx and read `process.env` directly. Plugins needing per-user OAuth use `ctx.getCredential("google")`.

## FieldDef

Each field drives multiple UI behaviors simultaneously:

```typescript
interface FieldDef {
  id: string            // Dot-path: "status", "author.name"
  label: string
  type: FieldType       // "text" | "html" | "markdown" | "date" | "number" | "boolean" | "select" | "multiselect"

  listRole?: "title" | "subtitle" | "timestamp" | "hidden"
  // If omitted, inferred: first text → title, second text → subtitle, first date → timestamp

  filter?: {
    filterable: true
    filterOptions?: (string | { value: string; label: string })[] | (() => Promise<string[]>)
    filterType?: "select" | "multiselect" | "text" | "date-range"
  }

  badge?: {
    show: "always" | "if-set"
    variant?: "default" | "secondary" | "destructive" | "outline"
    labelFn?: (value: string) => string  // Transform raw value to display label (return "" to hide)
    colorFn?: (value: string) => string  // Returns Tailwind CSS class
  }

  detailWidget?: WidgetDef  // Override default widget in detail view
}
```

## QueryResult & PluginItem

```typescript
interface QueryResult {
  items: PluginItem[]
  nextCursor?: string  // Pass back for pagination
}

interface PluginItem {
  id: string
  badges?: BadgeValue[]       // Pre-computed badges (overrides fieldSchema rules)
  [key: string]: unknown      // Plugin-specific fields
}
```

## PluginComponents

Declares custom React components for built-in plugins. External plugins typically omit this and use generic rendering.

```typescript
interface PluginComponents {
  tab?: string      // e.g. "gmail:tab" — overrides entire tab
  list?: string     // Custom list view
  detail?: string   // Custom detail view
}
```

## Auto-Generated REST Endpoints

Every plugin automatically gets these routes at `/api/{pluginId}/*`:

| Method | Path | Plugin Method |
|--------|------|---------------|
| GET | `/{id}/items` | `query(filters, cursor, ctx)` |
| GET | `/{id}/items/{itemId}` | `getItem(itemId, ctx)` |
| GET | `/{id}/items/{itemId}/subitems` | `querySubItems(itemId, filters, cursor, ctx)` |
| POST | `/{id}/items/{itemId}/mutate` | `mutate(itemId, action, payload, ctx)` |
| GET | `/{id}/fields/{fieldId}/options` | `filterOptions[fieldId](ctx)` |

Plugin manifests are listed at `GET /api/plugins`.

## Plugin Discovery

The loader scans three locations (in priority order):

1. `server/plugins/*.ts` — Built-in (highest priority)
2. `{workspace}/plugins/{id}/plugin.ts` — Workspace plugins
3. `{workspace}/inbox-plugins/*.ts` — Legacy flat files (lowest priority)

Each file must `export default` an object with at least `id` (string) and `query` (function).
