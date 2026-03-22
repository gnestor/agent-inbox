/**
 * Inbox Source Plugin — interface spec for third-party data sources.
 *
 * A source plugin is a TypeScript/JS file in `{workspace}/inbox-plugins/` that exports
 * a default object implementing `SourcePlugin`. The server loads all plugins at startup
 * via dynamic import and auto-generates REST routes at `/api/plugins/:sourceId/*`.
 *
 * Auth: plugins read credentials directly from `process.env` (set in workspace `.env`).
 * The app assumes the workspace already knows how to talk to the data source.
 *
 * Example:
 *   // {workspace}/inbox-plugins/slack-plugin.ts
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
 *   } satisfies SourcePlugin
 */

// ---------------------------------------------------------------------------
// Core item types
// ---------------------------------------------------------------------------

export interface PluginItem {
  /** Stable unique identifier for this item */
  id: string
  /** Optional pre-computed badges (overrides fieldSchema badge rules if provided) */
  badges?: import("./panels").BadgeValue[]
  /** Source-specific fields — anything goes */
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
  /** Returns a Tailwind CSS class string for custom coloring */
  colorFn?: (value: string) => string
}

export interface FilterConfig {
  /** Whether this field appears as a list filter */
  filterable: true
  /** Static options list, or async fn to fetch options from the source */
  filterOptions?: string[] | (() => Promise<string[]>)
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
// Source plugin interface
// ---------------------------------------------------------------------------

export interface QueryResult {
  items: PluginItem[]
  /** Pass back to the next query() call for pagination */
  nextCursor?: string
}

export interface SourcePlugin {
  /** Unique identifier — used in API routes and session linking */
  id: string
  /** Display name shown in the nav tab */
  name: string
  /** Lucide icon name (e.g. "MessageSquare", "Github", "ShoppingCart") */
  icon: string

  /**
   * Fetch a page of items from the source.
   * `filters` keys match FieldDef.id values where filter.filterable is true.
   * Values are strings; multi-select values are comma-separated.
   */
  query(
    filters: Record<string, string>,
    cursor?: string
  ): Promise<QueryResult>

  /**
   * Perform a mutation on an item.
   * Actions are source-defined strings (e.g. "archive", "reply", "mark-done").
   * Payload shape is action-specific.
   */
  mutate(id: string, action: string, payload?: unknown): Promise<void>

  /**
   * Optional per-action payload schemas for runtime validation.
   * Keys are action names, values are Zod schemas.
   * When provided, the server validates payloads before calling mutate().
   */
  actionSchemas?: Record<string, import("zod").ZodType>

  /**
   * Combined schema for filter UI, list badge rendering, and detail view layout.
   * Fields are rendered in the order they appear in this array.
   */
  fieldSchema: FieldDef[]

  /**
   * Optional detail widget tree. If omitted, the detail view is auto-generated
   * from fieldSchema (fields with type "html" or "markdown" become prose widgets;
   * other fields become kv-table entries).
   */
  detailSchema?: import("./panels").WidgetDef[]

  /**
   * Optional sub-item query — e.g. messages within a channel.
   * When present, the detail panel renders a scrollable sub-item list instead
   * of the widget tree.  The `itemId` is the parent item's id.
   */
  querySubItems?(
    itemId: string,
    filters: Record<string, string>,
    cursor?: string
  ): Promise<QueryResult>
}
