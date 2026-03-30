/**
 * Inbox Plugin — interface spec for integrations with external services.
 *
 * A plugin is a TypeScript/JS file that exports a default object implementing `Plugin`.
 * Plugins can live in:
 *   - `{workspace}/plugins/{id}/plugin.ts` (workspace plugins)
 *   - `{workspace}/inbox-plugins/*.ts` (legacy, backward compat)
 *   - `packages/inbox/server/plugins/` (built-in plugins)
 *
 * The server loads all plugins at startup via dynamic import and auto-generates
 * REST routes at `/api/{pluginId}/*`.
 *
 * Auth: plugins receive a `PluginContext` with credential resolution, or can
 * read credentials directly from `process.env` (set in workspace `.env`).
 *
 * Example:
 *   // {workspace}/plugins/slack/plugin.ts
 *   import { WebClient } from "@slack/web-api"
 *   const slack = new WebClient(process.env.SLACK_BOT_TOKEN)
 *
 *   export default {
 *     id: "slack",
 *     name: "Slack",
 *     icon: "MessageSquare",
 *     fieldSchema: [...],
 *     async query(filters, cursor) { ... },
 *     async mutate(id, action, payload) { ... },
 *   } satisfies Plugin
 */

// ---------------------------------------------------------------------------
// Core item types
// ---------------------------------------------------------------------------

export interface PluginItem {
  /** Stable unique identifier for this item */
  id: string
  /** Optional pre-computed badges (overrides fieldSchema badge rules if provided) */
  badges?: import("./panels").BadgeValue[]
  /** Plugin-specific fields — anything goes */
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Field schema (combined filter + badge + detail widget spec)
// ---------------------------------------------------------------------------

export type FieldType =
  | "text"
  | "html"       // Sanitized HTML body
  | "markdown"
  | "date"
  | "number"
  | "boolean"
  | "select"     // Single-value enum
  | "multiselect" // Array of strings

export interface BadgeConfig {
  /** When to show this badge in the list item */
  show: "always" | "if-set"
  /** shadcn Badge variant */
  variant?: "default" | "secondary" | "destructive" | "outline"
  /** Transforms the raw value into a display label */
  labelFn?: (value: string) => string
  /** Returns a Tailwind CSS class string for custom coloring */
  colorFn?: (value: string) => string
}

export interface FilterConfig {
  /** Whether this field appears as a list filter */
  filterable: true
  /** Static options list, or async fn to fetch options from the source */
  filterOptions?: (string | { value: string; label: string })[] | (() => Promise<string[]>)
  /** Defaults to field type — override if filter UI differs from field type */
  filterType?: "select" | "multiselect" | "text" | "date-range"
}

export interface FieldDef {
  /** Dot-path into the PluginItem object, e.g. "status", "author.name" */
  id: string
  label: string
  type: FieldType

  /** Filter behavior — omit to hide from filter UI */
  filter?: FilterConfig

  /** Badge behavior — omit to hide from list item badges */
  badge?: BadgeConfig

  /**
   * Widget to use in the detail view for this field.
   * Defaults to a sensible widget based on `type` (e.g. html → prose, date → kv-table entry).
   * Only needed to override the default or to add widget-specific options.
   */
  detailWidget?: import("./panels").WidgetDef

  /**
   * Role in the list view. If omitted, inferred from type:
   * first text → title, second text → subtitle, first date → timestamp.
   * Use "hidden" to exclude from list rendering.
   */
  listRole?: "title" | "subtitle" | "timestamp" | "hidden"
}

// ---------------------------------------------------------------------------
// Plugin context (request-scoped, passed by the server to plugin methods)
// ---------------------------------------------------------------------------

export interface PluginContext {
  /** Email of the authenticated user making the request */
  userEmail: string
  /** Resolve a credential for an integration (per-user OAuth or workspace API key) */
  getCredential(integration: string): Promise<string | null>
}

// ---------------------------------------------------------------------------
// Plugin components (custom client-side rendering)
// ---------------------------------------------------------------------------

/**
 * Custom component declarations for client-side rendering.
 *
 * Built-in plugins declare string keys that the client resolves via a static
 * registry of imported React components. E.g. `{ tab: "gmail:tab" }` → EmailTab.
 *
 * Plugins that omit `components` get generic PluginView rendering based on
 * fieldSchema/detailSchema (sufficient for simple plugins like Slack).
 */
export interface PluginComponents {
  /** Custom tab component (renders list + detail panels). Overrides generic PluginView entirely. */
  tab?: string
  /** Custom list view component. Used inside the generic tab layout. */
  list?: string
  /** Custom detail view component. Receives { itemId: string } props. */
  detail?: string
}

// ---------------------------------------------------------------------------
// Query result
// ---------------------------------------------------------------------------

export interface QueryResult {
  items: PluginItem[]
  /** Pass back to the next query() call for pagination */
  nextCursor?: string
}

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export interface Plugin {
  /** Unique identifier — used in API routes, tab IDs, and session linking */
  id: string
  /** Display name shown in the sidebar */
  name: string
  /** Lucide icon name (e.g. "MessageSquare", "Github", "ShoppingCart") */
  icon: string
  /** Emoji for sidebar display (alternative to Lucide icon) */
  emoji?: string
  /** Custom React components for rendering (omit for generic PluginView rendering) */
  components?: PluginComponents
  /** Auth requirements — client shows connection prompts */
  auth?: { integrationId: string; scope: "user" | "workspace" }

  /** True for skills-only plugins (no tab, no data source) */
  hasSkills?: boolean
  /** Auto-populated by the loader — describes available skills */
  skillManifest?: { name: string; description: string }[]

  /**
   * Fetch a page of items from the plugin.
   * `filters` keys match FieldDef.id values where filter.filterable is true.
   * Values are strings; multi-select values are comma-separated.
   * Optional for skills-only plugins.
   */
  query?(
    filters: Record<string, string>,
    cursor?: string,
    ctx?: PluginContext
  ): Promise<QueryResult>

  /**
   * Perform a mutation on an item.
   * Actions are plugin-defined strings (e.g. "archive", "reply", "mark-done").
   * Payload shape is action-specific.
   * Optional for skills-only plugins.
   */
  mutate?(id: string, action: string, payload?: unknown, ctx?: PluginContext): Promise<unknown>

  /**
   * Optional per-action payload schemas for runtime validation.
   * Keys are action names, values are Zod schemas.
   * When provided, the server validates payloads before calling mutate().
   */
  actionSchemas?: Record<string, import("zod").ZodType>

  /**
   * Combined schema for filter UI, list badge rendering, and detail view layout.
   * Fields are rendered in the order they appear in this array.
   * Plugins without fieldSchema don't appear as tabs in the sidebar.
   */
  fieldSchema?: FieldDef[]

  /**
   * Optional detail widget tree. If omitted, the detail view is auto-generated
   * from fieldSchema (fields with type "html" or "markdown" become prose widgets;
   * other fields become kv-table entries).
   */
  detailSchema?: import("./panels").WidgetDef[]

  /**
   * Optional sub-item query — e.g. messages within a channel.
   * When present, the detail panel renders a scrollable sub-item list instead
   * of the widget tree. The `itemId` is the parent item's id.
   */
  querySubItems?(
    itemId: string,
    filters: Record<string, string>,
    cursor?: string,
    ctx?: PluginContext
  ): Promise<QueryResult>

  /**
   * Fetch a single item with full detail (e.g. email thread with all messages,
   * task with child blocks). Returns null if item not found.
   */
  getItem?(id: string, ctx?: PluginContext): Promise<PluginItem | null>

  /**
   * Optional async filter options fetchers. Keys are field IDs.
   * Called by the server to populate filter dropdowns with dynamic options.
   */
  filterOptions?: Record<string, (ctx?: PluginContext) => Promise<string[]>>

  /**
   * Register additional Hono routes under `/api/{pluginId}/`.
   * Use for endpoints that don't fit query/mutate (e.g. attachment proxy,
   * file upload, OAuth callback).
   */
  routes?(hono: import("hono").Hono, helpers: { getContext: (c: unknown) => Promise<PluginContext> }): void

  /**
   * Convert an item to a markdown string for the context index.
   * Return null to exclude the item from the context.
   * Used by the context backfill system.
   */
  itemToContext?(item: PluginItem): string | null
}

/** @deprecated Use Plugin instead */
export type SourcePlugin = Plugin
