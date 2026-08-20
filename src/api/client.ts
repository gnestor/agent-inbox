import type { ContractSchema } from "@hammies/contracts"
import { decodeApiJsonResponse } from "@hammies/contracts/http"
import {
  ActiveWorkspaceResponseSchema,
  AuthClientIdResponseSchema,
  AuthSessionResponseSchema,
  ConnectionsResponseSchema,
  CreateSessionResponseSchema,
  FieldOptionsResponseSchema,
  GitStatusSchema,
  LinkedSessionResponseSchema,
  OkSchema,
  PluginItemsResponseSchema,
  PluginItemSchema,
  PluginManifestTransportSchema,
  PreferencesSchema,
  ResumeSessionResponseSchema,
  SessionProjectsResponseSchema,
  SessionSnapshotResponseSchema,
  SessionsResponseSchema,
  UploadFileResultSchema,
  UserProfilesResponseSchema,
  UserProfileSchema,
  WidgetRegistrySchema,
  WorkspacesResponseSchema,
  WorkspaceDetailsSchema,
  type PluginManifestTransport,
} from "./contracts"

const BASE = "/api"
const SESSION_SNAPSHOT_MAX_BYTES = 50_000_000

async function request<T>(
  path: string,
  schema: ContractSchema<T>,
  options?: RequestInit,
  contractOptions?: {
    maxBytes?: number
  },
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  })
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("session-expired"))
  }
  return decodeApiJsonResponse<T>(res, schema, {
    contract: `inbox-api:${path.split("?")[0]}@1`,
    source: path,
    maxBytes: contractOptions?.maxBytes,
  })
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function getAuthClientId() {
  return request(`/auth/client-id`, AuthClientIdResponseSchema)
}

export async function authCallback(credential: string) {
  return request(`/auth/callback`, UserProfileSchema, {
    method: "POST",
    body: JSON.stringify({ credential }),
  })
}

export async function getAuthSession() {
  return request(`/auth/session`, AuthSessionResponseSchema)
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
    SessionsResponseSchema,
  )
}

export async function getSessionProjects() {
  return request(`/sessions/projects`, SessionProjectsResponseSchema)
}

export async function getSession(sessionId: string) {
  return request(`/sessions/${sessionId}`, SessionSnapshotResponseSchema, undefined, {
    maxBytes: SESSION_SNAPSHOT_MAX_BYTES,
  })
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
  return request(`/sessions`, CreateSessionResponseSchema, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function resumeSession(sessionId: string, prompt: string) {
  return request(
    `/sessions/${sessionId}/resume`,
    ResumeSessionResponseSchema,
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
  return decodeApiJsonResponse(res, UploadFileResultSchema, {
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
    LinkedSessionResponseSchema,
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
    PluginItemsResponseSchema,
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
    PluginItemsResponseSchema,
  )
}

export async function getFieldOptions(
  pluginId: string,
  fieldId: string,
) {
  return request(
    `/${pluginId}/fields/${fieldId}/options`,
    FieldOptionsResponseSchema,
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
  return request(`/connections`, ConnectionsResponseSchema)
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
    UserProfilesResponseSchema,
  )
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export async function getWorkspaces() {
  return request(`/workspaces`, WorkspacesResponseSchema)
}

export async function setActiveWorkspace(workspaceId: string) {
  return request(`/workspaces/active`, ActiveWorkspaceResponseSchema, {
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
    UserProfilesResponseSchema,
  )
}
