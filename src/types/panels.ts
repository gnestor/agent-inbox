/**
 * Inbox Panel Schema — composable widget types for workflow plugin panels and source detail views.
 *
 * Workflow plugins declare panels in `{workspace}/workflows/{name}/inbox-panels.json`.
 * The server reads these at startup and registers them as custom XML tag → widget tree mappings.
 * The `SessionTranscript` component renders them when the agent emits a matching XML tag.
 *
 * Source plugins use `WidgetDef[]` in `SourcePlugin.detailSchema` to render item detail views.
 *
 * Widget types map to shadcn components and app-provided renderers.
 *
 * inbox-panels.json example:
 *   {
 *     "github-issue-context": [
 *       { "type": "kv-table", "fields": ["title", "state", "author", "labels"] },
 *       { "type": "badge-row", "field": "labels" },
 *       { "type": "prose", "field": "body" }
 *     ],
 *     "github-issue-result": [
 *       { "type": "prose", "field": "summary" },
 *       { "type": "action-buttons", "actions": [
 *         { "label": "Close Issue", "mutation": "close-issue", "variant": "destructive" },
 *         { "label": "Add Label", "mutation": "add-label" }
 *       ]}
 *     ]
 *   }
 */

// ---------------------------------------------------------------------------
// Shared primitive types
// ---------------------------------------------------------------------------

export interface BadgeValue {
  label: string
  variant?: "default" | "secondary" | "destructive" | "outline"
  /** Tailwind class string for custom coloring, e.g. "bg-chart-1/20 text-chart-1" */
  className?: string
}

// ---------------------------------------------------------------------------
// Widget definitions
// ---------------------------------------------------------------------------

/** Rendered as sanitized HTML or markdown. Maps to the app's existing `<Markdown>` renderer. */
export interface ProseWidget {
  type: "prose"
  /** Dot-path to the field containing the HTML/markdown string */
  field: string
  format?: "html" | "markdown"
}

/** Key-value metadata table using shadcn Table. */
export interface KvTableWidget {
  type: "kv-table"
  /**
   * Field ids to include, in order. Each field's label comes from the source plugin's
   * fieldSchema (for source plugins) or falls back to the capitalized field name.
   */
  fields: string[]
}

/** Tabular data using shadcn DataTable. The field must be an array of objects. */
export interface DataTableWidget {
  type: "data-table"
  /** Dot-path to the field containing an array of row objects */
  field: string
  /** Column definitions. If omitted, columns are inferred from the first row's keys. */
  columns?: Array<{ id: string; label: string }>
}

/** Inline badge strip. The field must be a string (single badge) or string[] (multiple). */
export interface BadgeRowWidget {
  type: "badge-row"
  field: string
  /** Static variant for all badges from this field */
  variant?: BadgeValue["variant"]
  /** Returns a Tailwind class for a given badge value */
  colorFn?: (value: string) => string
}

export interface ActionDef {
  label: string
  /** Maps to a mutation action name in the source plugin or workflow mutations file */
  mutation: string
  /**
   * Dot-path to the field whose value is passed as payload to the mutation.
   * Omit to pass the entire panel data object.
   */
  payloadField?: string
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost"
}

/** One or more action buttons that call mutations. */
export interface ActionButtonsWidget {
  type: "action-buttons"
  actions: ActionDef[]
}

/** Collapsible JSON tree viewer. The field must be an object or array. */
export interface JsonTreeWidget {
  type: "json-tree"
  field: string
  /** Collapsed by default */
  collapsed?: boolean
}

/** shadcn chart — bar, line, pie, or area. The field must match the chart data shape. */
export interface ChartWidget {
  type: "chart"
  field: string
  chartType: "bar" | "line" | "pie" | "area"
  /** Field name for the x-axis / category */
  xKey: string
  /** Field name(s) for the y-axis / values */
  yKeys: string[]
}

/** Vega-Lite visualization. The field must be a Vega-Lite spec object. */
export interface VegaLiteWidget {
  type: "vega-lite"
  field: string
}

/** Full-width image. The field must be a URL string. */
export interface ImageWidget {
  type: "image"
  field: string
  alt?: string
}

/** Syntax-highlighted code block. The field must be a string. */
export interface CodeBlockWidget {
  type: "code-block"
  field: string
  language?: string
}

/** List of file/link attachments with icons and download links. */
export interface AttachmentListWidget {
  type: "attachment-list"
  /** Dot-path to an array of { name, url, mimeType?, size? } objects */
  field: string
}

/** List of related items that navigate to another source/workflow on click. */
export interface ItemListWidget {
  type: "item-list"
  /** Dot-path to an array of { id, title, subtitle?, sourceId? } objects */
  field: string
  /** Source plugin id to navigate to on click. Omit to use current source. */
  sourceId?: string
}

/**
 * Jupyter-style MIME bundle rendering.
 * The field must be a `{ [mimeType: string]: data }` object.
 * The app renders the richest MIME type it knows how to display.
 * Built-in: text/html, text/markdown, application/json, image/*, application/vnd.vega-lite+json
 */
export interface MimeWidget {
  type: "mime"
  field: string
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type WidgetDef =
  | ProseWidget
  | KvTableWidget
  | DataTableWidget
  | BadgeRowWidget
  | ActionButtonsWidget
  | JsonTreeWidget
  | ChartWidget
  | VegaLiteWidget
  | ImageWidget
  | CodeBlockWidget
  | AttachmentListWidget
  | ItemListWidget
  | MimeWidget

// ---------------------------------------------------------------------------
// inbox-panels.json schema
// ---------------------------------------------------------------------------

/**
 * The shape of `{workspace}/workflows/{name}/inbox-panels.json`.
 *
 * Keys are XML tag names that the agent will emit (without angle brackets).
 * Values are arrays of widget definitions that render the JSON payload inside that tag.
 *
 * The companion WORKFLOW.md instructs the agent to emit these tags with matching JSON.
 * The companion inbox-mutations.ts (optional) exports handler functions for action mutations.
 */
export type PanelSchema = Record<string, WidgetDef[]>

/**
 * Mutation context passed to inbox-mutations.ts handler functions.
 * Provides access to the workspace path and environment for making API calls.
 */
export interface MutationContext {
  workspacePath: string
  env: Record<string, string | undefined>
}

/**
 * The shape of `{workspace}/workflows/{name}/inbox-mutations.ts`.
 * Each export is an async function keyed by the mutation action name used in ActionDef.
 */
export type MutationHandlers = Record<
  string,
  (payload: unknown, ctx: MutationContext) => Promise<void>
>
