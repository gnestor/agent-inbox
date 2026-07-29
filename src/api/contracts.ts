import { z } from "zod"
import type {
  Integration,
  Session,
  SessionMessage,
  UserProfile,
  Workspace,
  WorkspaceMember,
} from "@/types"
import type {
  FieldDef,
  PluginComponents,
  PluginItem,
} from "@/types/plugin"
import type { WidgetDef } from "@/types/panels"

export const OkSchema = z.object({ ok: z.boolean() })
export const UserProfileSchema: z.ZodType<UserProfile> = z.object({
  name: z.string(),
  email: z.email(),
  picture: z.string().optional(),
})
export const WorkspaceSchema: z.ZodType<Workspace> = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["admin", "member"]),
})
export const WorkspaceMemberSchema: z.ZodType<WorkspaceMember> = z.object({
  workspace_id: z.string(),
  user_email: z.email(),
  role: z.enum(["admin", "member"]),
  created_at: z.string(),
  name: z.string(),
  picture: z.string().optional(),
})
export const SessionSchema: z.ZodType<Session> = z.object({
  id: z.string(),
  status: z.enum([
    "running",
    "complete",
    "needs_attention",
    "errored",
    "awaiting_user_input",
    "archived",
  ]),
  prompt: z.string(),
  summary: z.string().nullable(),
  startedAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  linkedSourceType: z.string().nullable(),
  linkedSourceId: z.string().nullable(),
  triggerSource: z.string(),
  project: z.string(),
  linkedItemTitle: z.string().nullable(),
  hasActiveProcess: z.boolean().optional(),
})
export const SessionMessageSchema: z.ZodType<SessionMessage> = z.custom<SessionMessage>(
  (value) => {
    if (typeof value !== "object" || value === null) return false
    const record = value as Record<string, unknown>
    return typeof record.id === "string"
      && typeof record.sessionId === "string"
      && typeof record.sequence === "number"
      && Number.isFinite(record.sequence)
      && typeof record.type === "string"
      && typeof record.message === "object"
      && record.message !== null
      && typeof record.createdAt === "string"
  },
)
export const IntegrationSchema: z.ZodType<Integration> = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  iconUrl: z.string().optional(),
  scope: z.enum(["user", "workspace"]),
  authType: z.enum(["oauth2", "api_key"]),
  connected: z.boolean(),
})
export const PluginItemSchema: z.ZodType<PluginItem> = z.object({
  id: z.string(),
  badges: z.array(z.object({
    label: z.string(),
    variant: z.enum(["default", "secondary", "destructive", "outline"]).optional(),
    className: z.string().optional(),
  })).optional(),
}).loose()

const WidgetSchema: z.ZodType<WidgetDef> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prose"), field: z.string(), format: z.enum(["html", "markdown"]).optional() }),
  z.object({ type: z.literal("kv-table"), fields: z.array(z.string()) }),
  z.object({
    type: z.literal("data-table"),
    field: z.string(),
    columns: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  }),
  z.object({
    type: z.literal("badge-row"),
    field: z.string(),
    variant: z.enum(["default", "secondary", "destructive", "outline"]).optional(),
  }),
  z.object({
    type: z.literal("action-buttons"),
    actions: z.array(z.object({
      label: z.string(),
      mutation: z.string(),
      payloadField: z.string().optional(),
      variant: z.enum(["default", "secondary", "destructive", "outline", "ghost"]).optional(),
    })),
  }),
  z.object({ type: z.literal("json-tree"), field: z.string(), collapsed: z.boolean().optional() }),
  z.object({
    type: z.literal("chart"),
    field: z.string(),
    chartType: z.enum(["bar", "line", "pie", "area"]),
    xKey: z.string(),
    yKeys: z.array(z.string()),
  }),
  z.object({ type: z.literal("vega-lite"), field: z.string() }),
  z.object({ type: z.literal("image"), field: z.string(), alt: z.string().optional() }),
  z.object({ type: z.literal("code-block"), field: z.string(), language: z.string().optional() }),
  z.object({ type: z.literal("attachment-list"), field: z.string() }),
  z.object({ type: z.literal("item-list"), field: z.string(), sourceId: z.string().optional() }),
  z.object({ type: z.literal("mime"), field: z.string() }),
])

const FieldSchema: z.ZodType<FieldDef> = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum([
    "text",
    "html",
    "markdown",
    "date",
    "number",
    "boolean",
    "select",
    "multiselect",
  ]),
  filter: z.object({
    filterable: z.literal(true),
    filterOptions: z.array(z.union([
      z.string(),
      z.object({ value: z.string(), label: z.string() }),
    ])).optional(),
    filterType: z.enum(["select", "multiselect", "text", "date-range"]).optional(),
  }).optional(),
  badge: z.object({
    show: z.enum(["always", "if-set"]),
    variant: z.enum(["default", "secondary", "destructive", "outline"]).optional(),
  }).optional(),
  detailWidget: WidgetSchema.optional(),
  listRole: z.enum(["title", "subtitle", "timestamp", "hidden"]).optional(),
})

const PluginComponentsSchema: z.ZodType<PluginComponents> = z.object({
  tab: z.string().optional(),
  list: z.string().optional(),
  detail: z.string().optional(),
})

export interface PluginManifestTransport {
  id: string
  name: string
  icon: string
  emoji?: string
  components?: PluginComponents
  auth?: { integrationId: string; scope: "user" | "workspace" }
  fieldSchema: FieldDef[]
  detailSchema?: WidgetDef[]
  listRowHeight?: number
  hasSubItems?: boolean
  hasGetItem?: boolean
  hasFilterOptions?: boolean
}

export const SessionSummarySchema = z.object({
  id: z.string(),
  status: z.string(),
  prompt: z.string(),
  summary: z.string().nullable(),
  updatedAt: z.string(),
})
export const UploadFileResultSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
})
export const PluginManifestTransportSchema: z.ZodType<PluginManifestTransport> = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  emoji: z.string().optional(),
  components: PluginComponentsSchema.optional(),
  auth: z.object({
    integrationId: z.string(),
    scope: z.enum(["user", "workspace"]),
  }).optional(),
  fieldSchema: z.array(FieldSchema),
  detailSchema: z.array(WidgetSchema).optional(),
  listRowHeight: z.number().positive().optional(),
  hasSubItems: z.boolean().optional(),
  hasGetItem: z.boolean().optional(),
  hasFilterOptions: z.boolean().optional(),
})
export const WidgetRegistrySchema: z.ZodType<Record<string, WidgetDef[]>> = z.record(
  z.string(),
  z.array(WidgetSchema),
)
export const PreferencesSchema = z.record(z.string(), z.unknown())
export const GitStatusSchema = z.object({
  branch: z.string().nullable(),
  remote: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  status: z.array(z.string()),
})
export const WorkspaceDetailsSchema = z.object({
  workspace: z.object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
  members: z.array(WorkspaceMemberSchema),
})
