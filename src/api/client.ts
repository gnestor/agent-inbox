const BASE = "/api"

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function getAuthClientId() {
  return request<{ clientId: string }>(`/auth/client-id`)
}

export async function authCallback(credential: string) {
  return request<import("@/types").UserProfile>(`/auth/callback`, {
    method: "POST",
    body: JSON.stringify({ credential }),
  })
}

export async function getAuthSession() {
  return request<{
    user: import("@/types").UserProfile | null
    workspaces?: import("@/types").Workspace[]
    activeWorkspace?: import("@/types").Workspace | null
  }>(`/auth/session`)
}

export async function logout() {
  return request<{ ok: boolean }>(`/auth/logout`, { method: "POST" })
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
  return request<{ sessions: import("@/types").Session[] }>(`/sessions${qs ? `?${qs}` : ""}`)
}

export async function getSessionProjects() {
  return request<{ projects: string[] }>(`/sessions/projects`)
}

export async function getSession(sessionId: string) {
  return request<{
    session: import("@/types").Session
    messages: import("@/types").SessionMessage[]
    latestSequence?: number
  }>(`/sessions/${sessionId}`)
}

export async function updateSession(sessionId: string, body: { summary: string }) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}`, {
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
  return request<{ sessionId: string }>(`/sessions`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function resumeSession(sessionId: string, prompt: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/resume`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  })
}

export async function updateArtifactCode(sessionId: string, toolUseId: string, code: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/artifact`, {
    method: "PATCH",
    body: JSON.stringify({ toolUseId, code }),
  })
}

export async function abortSession(sessionId: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/abort`, {
    method: "POST",
  })
}

export async function archiveSession(sessionId: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/archive`, {
    method: "POST",
  })
}

export async function unarchiveSession(sessionId: string) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/unarchive`, {
    method: "POST",
  })
}

export async function answerSessionQuestion(sessionId: string, answers: Record<string, string>) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/answer`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  })
}

export async function attachToSession(
  sessionId: string,
  body: { type: string; id: string; title: string; content: string },
) {
  return request<{ ok: boolean }>(`/sessions/${sessionId}/attach`, {
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
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json() as Promise<{ name: string; path: string; size: number; mimeType: string }>
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
  return request<{ session: { id: string; status: string; prompt: string; summary: string | null; updatedAt: string } | null }>(
    `/sessions/linked?${params}`,
  )
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export interface PluginManifest {
  id: string
  name: string
  icon: string
  emoji?: string
  components?: import("@/types/plugin").PluginComponents
  auth?: { integrationId: string; scope: "user" | "workspace" }
  fieldSchema: import("@/types/plugin").FieldDef[]
  detailSchema?: import("@/types/panels").WidgetDef[]
  listRowHeight?: number
  hasSubItems?: boolean
  hasGetItem?: boolean
  hasFilterOptions?: boolean
}

export async function getPlugins() {
  return request<PluginManifest[]>(`/plugins`)
}

export async function queryPluginItems(
  pluginId: string,
  filters: Record<string, string>,
  cursor?: string
) {
  const params = new URLSearchParams(filters)
  if (cursor) params.set("cursor", cursor)
  const qs = params.toString()
  return request<{ items: import("@/types/plugin").PluginItem[]; nextCursor?: string }>(
    `/${pluginId}/items${qs ? `?${qs}` : ""}`,
  )
}

export async function getPluginItem(
  pluginId: string,
  itemId: string,
) {
  return request<import("@/types/plugin").PluginItem>(
    `/${pluginId}/items/${encodeURIComponent(itemId)}`,
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
  return request<{ items: import("@/types/plugin").PluginItem[]; nextCursor?: string }>(
    `/${pluginId}/items/${itemId}/subitems${qs ? `?${qs}` : ""}`,
  )
}

export async function getFieldOptions(
  pluginId: string,
  fieldId: string,
) {
  return request<{ options: string[] }>(
    `/${pluginId}/fields/${fieldId}/options`,
  )
}

export async function getPanelSchemas() {
  return request<Record<string, import("@/types/panels").WidgetDef[]>>(`/panels`)
}

export async function mutatePluginItem(
  pluginId: string,
  itemId: string,
  action: string,
  payload?: unknown
) {
  return request<{ ok: boolean }>(`/${pluginId}/items/${itemId}/mutate`, {
    method: "POST",
    body: JSON.stringify({ action, payload }),
  })
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export async function getConnections() {
  return request<{ integrations: import("@/types").Integration[] }>(`/connections`)
}

export async function disconnectIntegration(integration: string) {
  return request<{ ok: boolean }>(`/connections/${integration}`, {
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
  return request<Record<string, unknown>>(`/preferences`)
}

export async function setPreference(key: string, value: unknown) {
  return request<{ ok: boolean }>(`/preferences`, {
    method: "PUT",
    body: JSON.stringify({ key, value }),
  })
}

export async function getUserProfiles(emails: string[]): Promise<{ users: { email: string; name: string; picture?: string }[] }> {
  return request(`/users?emails=${emails.map(encodeURIComponent).join(",")}`)
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export async function getWorkspaces() {
  return request<{ workspaces: import("@/types").Workspace[]; activeWorkspaceId: string | null }>(`/workspaces`)
}

export async function setActiveWorkspace(workspaceId: string) {
  return request<{ id: string; name: string }>(`/workspaces/active`, {
    method: "PUT",
    body: JSON.stringify({ workspaceId }),
  })
}

export async function getWorkspaceDetails(workspaceId: string) {
  return request<{ workspace: unknown; members: import("@/types").WorkspaceMember[] }>(`/workspaces/${workspaceId}`)
}

export async function renameWorkspace(workspaceId: string, name: string) {
  return request<{ ok: boolean }>(`/workspaces/${workspaceId}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  })
}

export async function getWorkspaceGitInfo(workspaceId: string) {
  return request<{ branch: string | null; remote: string | null; remoteUrl: string | null; status: string[] }>(
    `/workspaces/${workspaceId}/git`,
  )
}

export async function addWorkspaceMember(workspaceId: string, email: string, role?: string) {
  return request<{ ok: boolean }>(`/workspaces/${workspaceId}/members`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  })
}

export async function removeWorkspaceMember(workspaceId: string, email: string) {
  return request<{ ok: boolean }>(`/workspaces/${workspaceId}/members/${encodeURIComponent(email)}`, {
    method: "DELETE",
  })
}

export async function updateMemberRole(workspaceId: string, email: string, role: string) {
  return request<{ ok: boolean }>(`/workspaces/${workspaceId}/members/${encodeURIComponent(email)}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  })
}

export async function getAvailableUsers(workspaceId: string) {
  return request<{ users: import("@/types").UserProfile[] }>(`/workspaces/${workspaceId}/available-users`)
}
