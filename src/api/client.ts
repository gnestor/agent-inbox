import { z } from "zod"
import { decodeJsonResponse } from "@hammies/contracts/http"
import {
  GitStatusSchema,
  IntegrationSchema,
  OkSchema,
  PluginItemSchema,
  PluginManifestTransportSchema,
  PreferencesSchema,
  SessionSchema,
  SessionMessageSchema,
  SessionSummarySchema,
  UploadFileResultSchema,
  UserProfileSchema,
  WidgetRegistrySchema,
  WorkspaceSchema,
  WorkspaceDetailsSchema,
  type PluginManifestTransport,
} from "./contracts"

const BASE = "/api"

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  })
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("session-expired"))
  }
  return decodeJsonResponse(res, schema, {
    contract: `inbox-api:${path.split("?")[0]}@1`,
    source: path,
  })
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function getAuthClientId() {
  return request(`/auth/client-id`, z.object({ clientId: z.string() }))
}

export async function authCallback(credential: string) {
  return request(`/auth/callback`, UserProfileSchema, {
    method: "POST",
    body: JSON.stringify({ credential }),
  })
}

export async function getAuthSession() {
  return request(`/auth/session`, z.object({
    user: UserProfileSchema.nullable(),
    workspaces: z.array(WorkspaceSchema).optional(),
    activeWorkspace: WorkspaceSchema.nullable().optional(),
  }))
}

export async function logout() {
  return request(`/auth/logout`, OkSchema, { method: "POST" })
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function getSessions(filters?: {
  status?: string
  triggerSource?: string
  project?: string
  q?: string
}) {
  const params = new URLSearchParams()
  if (filters?.status) params.set("status", filters.status)
  if (filters?.triggerSource) params.set("trigger_source", filters.triggerSource)
  if (filters?.project) params.set("project", filters.project)
  if (filters?.q) params.set("q", filters.q)
  const qs = params.toString()
  return request(
    `/sessions${qs ? `?${qs}` : ""}`,
    z.object({ sessions: z.array(SessionSchema) }),
  )
}

export async function getSessionProjects() {
  return request(`/sessions/projects`, z.object({ projects: z.array(z.string()) }))
}

export async function getSession(sessionId: string) {
  return request(`/sessions/${sessionId}`, z.object({
    session: SessionSchema,
    messages: z.array(SessionMessageSchema),
    latestSequence: z.number().finite().optional(),
  }))
}

export async function updateSession(sessionId: string, body: { summary: string }) {
  return request(`/sessions/${sessionId}`, OkSchema, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

export async function createSession(body: {
  prompt: string
  linkedSourceType?: string
  linkedSourceId?: string
  linkedSourceContent?: string
  linkedItemTitle?: string
}) {
  return request(`/sessions`, z.object({ sessionId: z.string() }), {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function resumeSession(sessionId: string, prompt: string) {
  return request(
    `/sessions/${sessionId}/resume`,
    z.object({ ok: z.boolean(), queued: z.boolean().optional() }),
    {
    method: "POST",
    body: JSON.stringify({ prompt }),
    },
  )
}

export async function updateArtifactCode(sessionId: string, toolUseId: string, code: string) {
  return request(`/sessions/${sessionId}/artifact`, OkSchema, {
    method: "PATCH",
    body: JSON.stringify({ toolUseId, code }),
  })
}

export async function abortSession(sessionId: string) {
  return request(`/sessions/${sessionId}/abort`, OkSchema, {
    method: "POST",
  })
}

export async function archiveSession(sessionId: string) {
  return request(`/sessions/${sessionId}/archive`, OkSchema, {
    method: "POST",
  })
}

export async function unarchiveSession(sessionId: string) {
  return request(`/sessions/${sessionId}/unarchive`, OkSchema, {
    method: "POST",
  })
}

export async function answerSessionQuestion(sessionId: string, answers: Record<string, string>) {
  return request(`/sessions/${sessionId}/answer`, OkSchema, {
    method: "POST",
    body: JSON.stringify({ answers }),
  })
}

export async function attachToSession(
  sessionId: string,
  body: { type: string; id: string; title: string; content: string },
) {
  return request(`/sessions/${sessionId}/attach`, OkSchema, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function uploadSessionFile(sessionId: string, file: File) {
  const form = new FormData()
  form.append("file", file)
  const res = await fetch(`${BASE}/sessions/${sessionId}/files`, {
    method: "POST",
    body: form,
  })
  return decodeJsonResponse(res, UploadFileResultSchema, {
    contract: "inbox-session-file-upload@1",
    source: `/sessions/${sessionId}/files`,
  })
}

export function getSessionFileUrl(sessionId: string, filename: string, absolutePath?: string): string {
  const base = `${BASE}/sessions/${sessionId}/files/${encodeURIComponent(filename)}`
  if (absolutePath) {
    return `${base}?path=${encodeURIComponent(absolutePath)}`
  }
  return base
}

export async function getLinkedSession(sourceId: string, sourceType: string) {
  const params = new URLSearchParams({ sourceId, sourceType })
  return request(
    `/sessions/linked?${params}`,
    z.object({ session: SessionSummarySchema.nullable() }),
  )
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export type PluginManifest = PluginManifestTransport

export async function getPlugins() {
  return request(`/plugins`, PluginManifestTransportSchema.array())
}

export async function queryPluginItems(
  pluginId: string,
  filters: Record<string, string>,
  cursor?: string
) {
  const params = new URLSearchParams(filters)
  if (cursor) params.set("cursor", cursor)
  const qs = params.toString()
  return request(
    `/${pluginId}/items${qs ? `?${qs}` : ""}`,
    z.object({
      items: z.array(PluginItemSchema),
      nextCursor: z.string().optional(),
    }),
  )
}

export async function getPluginItem(
  pluginId: string,
  itemId: string,
) {
  return request(
    `/${pluginId}/items/${encodeURIComponent(itemId)}`,
    PluginItemSchema,
  )
}

export async function queryPluginSubItems(
  pluginId: string,
  itemId: string,
  filters: Record<string, string>,
  cursor?: string
) {
  const params = new URLSearchParams(filters)
  if (cursor) params.set("cursor", cursor)
  const qs = params.toString()
  return request(
    `/${pluginId}/items/${itemId}/subitems${qs ? `?${qs}` : ""}`,
    z.object({
      items: z.array(PluginItemSchema),
      nextCursor: z.string().optional(),
    }),
  )
}

export async function getFieldOptions(
  pluginId: string,
  fieldId: string,
) {
  return request(
    `/${pluginId}/fields/${fieldId}/options`,
    z.object({ options: z.array(z.string()) }),
  )
}

export async function getPanelSchemas() {
  return request(`/panels`, WidgetRegistrySchema)
}

export async function mutatePluginItem(
  pluginId: string,
  itemId: string,
  action: string,
  payload?: unknown
) {
  return request(`/${pluginId}/items/${itemId}/mutate`, OkSchema, {
    method: "POST",
    body: JSON.stringify({ action, payload }),
  })
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export async function getConnections() {
  return request(`/connections`, z.object({ integrations: z.array(IntegrationSchema) }))
}

export async function disconnectIntegration(integration: string) {
  return request(`/connections/${integration}`, OkSchema, {
    method: "DELETE",
  })
}

export function getConnectUrl(integration: string): string {
  return `${BASE}/connections/connect/${integration}`
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export async function getPreferences() {
  return request(`/preferences`, PreferencesSchema)
}

export async function setPreference(key: string, value: unknown) {
  return request(`/preferences`, OkSchema, {
    method: "PUT",
    body: JSON.stringify({ key, value }),
  })
}

export async function getUserProfiles(emails: string[]): Promise<{ users: { email: string; name: string; picture?: string }[] }> {
  return request(
    `/users?emails=${emails.map(encodeURIComponent).join(",")}`,
    z.object({ users: z.array(UserProfileSchema) }),
  )
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export async function getWorkspaces() {
  return request(`/workspaces`, z.object({
    workspaces: z.array(WorkspaceSchema),
    activeWorkspaceId: z.string().nullable(),
  }))
}

export async function setActiveWorkspace(workspaceId: string) {
  return request(`/workspaces/active`, z.object({ id: z.string(), name: z.string() }), {
    method: "PUT",
    body: JSON.stringify({ workspaceId }),
  })
}

export async function getWorkspaceDetails(workspaceId: string) {
  return request(`/workspaces/${workspaceId}`, WorkspaceDetailsSchema)
}

export async function renameWorkspace(workspaceId: string, name: string) {
  return request(`/workspaces/${workspaceId}`, OkSchema, {
    method: "PUT",
    body: JSON.stringify({ name }),
  })
}

export async function getWorkspaceGitInfo(workspaceId: string) {
  return request(
    `/workspaces/${workspaceId}/git`,
    GitStatusSchema,
  )
}

export async function addWorkspaceMember(workspaceId: string, email: string, role?: string) {
  return request(`/workspaces/${workspaceId}/members`, OkSchema, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  })
}

export async function removeWorkspaceMember(workspaceId: string, email: string) {
  return request(`/workspaces/${workspaceId}/members/${encodeURIComponent(email)}`, OkSchema, {
    method: "DELETE",
  })
}

export async function updateMemberRole(workspaceId: string, email: string, role: string) {
  return request(`/workspaces/${workspaceId}/members/${encodeURIComponent(email)}`, OkSchema, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  })
}

export async function getAvailableUsers(workspaceId: string) {
  return request(
    `/workspaces/${workspaceId}/available-users`,
    z.object({ users: z.array(UserProfileSchema) }),
  )
}
