/**
 * Zod schemas for API boundary validation.
 *
 * These schemas validate:
 * 1. Incoming request bodies (route handlers)
 * 2. Database row shapes (query results)
 * 3. Outgoing response shapes (API responses)
 *
 * Using Zod at boundaries catches mismatches between what the code expects
 * and what actually arrives at runtime — the class of bugs that TypeScript
 * alone cannot prevent.
 */
import { z } from "zod/v4"

/** Parse untrusted JSON without allowing the standard library's `any` return
 * type to escape into application code. Callers must narrow or schema-parse. */
export const parseJson: (text: string) => unknown = JSON.parse

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Request body schemas (server route inputs)
// ---------------------------------------------------------------------------

export const CreateSessionBody = z.object({
  prompt: z.string().min(1, "prompt is required"),
  linkedSourceType: z.string().optional(),
  linkedSourceId: z.string().optional(),
  linkedSourceContent: z.string().optional(),
  linkedItemTitle: z.string().optional(),
})
export type CreateSessionBody = z.infer<typeof CreateSessionBody>

export const ResumeSessionBody = z.object({
  prompt: z.string().min(1, "prompt is required"),
})
export type ResumeSessionBody = z.infer<typeof ResumeSessionBody>

export const UpdateSessionBody = z.object({
  summary: z.string(),
})
export type UpdateSessionBody = z.infer<typeof UpdateSessionBody>

export const AnswerSessionBody = z.object({
  answers: z.record(z.string(), z.string()),
})
export type AnswerSessionBody = z.infer<typeof AnswerSessionBody>

export const AttachToSessionBody = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
  title: z.string().optional(),
  content: z.string().min(1),
})
export type AttachToSessionBody = z.infer<typeof AttachToSessionBody>

export const PatchArtifactBody = z.object({
  toolUseId: z.string().min(1),
  code: z.string(),
})
export type PatchArtifactBody = z.infer<typeof PatchArtifactBody>

export const PluginMutateBody = z.object({
  action: z.string().min(1, "action is required"),
  payload: z.unknown().optional(),
})
export type PluginMutateBody = z.infer<typeof PluginMutateBody>

export const AuthCallbackBody = z.object({
  credential: z.string().min(1),
})
export type AuthCallbackBody = z.infer<typeof AuthCallbackBody>

export const SetPreferenceBody = z.object({
  key: z.string().min(1),
  value: z.unknown(),
})
export type SetPreferenceBody = z.infer<typeof SetPreferenceBody>

export const BatchPreferencesBody = z.object({
  prefs: z.record(z.string(), z.unknown()),
})

export const GoogleTokenResponse = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
})

export const OAuthTokenResponse = z.object({
  access_token: z.string().optional(),
  authed_user: z.object({ access_token: z.string().optional() }).optional(),
  bot: z.object({ bot_access_token: z.string().optional() }).optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  expires_in: z.number().positive().optional(),
})

export const AddWorkspaceMemberBody = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).optional(),
})
export type AddWorkspaceMemberBody = z.infer<typeof AddWorkspaceMemberBody>

export const RenameWorkspaceBody = z.object({
  name: z.string().min(1),
})
export type RenameWorkspaceBody = z.infer<typeof RenameWorkspaceBody>

export const SetActiveWorkspaceBody = z.object({
  workspaceId: z.string().min(1),
})
export type SetActiveWorkspaceBody = z.infer<typeof SetActiveWorkspaceBody>

export const UpdateMemberRoleBody = z.object({
  role: z.enum(["admin", "member"]),
})
export type UpdateMemberRoleBody = z.infer<typeof UpdateMemberRoleBody>

// ---------------------------------------------------------------------------
// Database row schemas
// ---------------------------------------------------------------------------

export const SessionRow = z.object({
  id: z.string(),
  status: z.string(),
  prompt: z.string(),
  summary: z.string().nullable(),
  started_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
  linked_source_type: z.string().nullable(),
  linked_source_id: z.string().nullable(),
  trigger_source: z.string(),
  linked_item_title: z.string().nullable(),
})
export type SessionRow = z.infer<typeof SessionRow>

export const WorkspaceRow = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  created_at: z.string(),
})
export type WorkspaceRow = z.infer<typeof WorkspaceRow>

export const UserRow = z.object({
  email: z.string(),
  name: z.string(),
  picture: z.string().nullable(),
})
export type UserRow = z.infer<typeof UserRow>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse request JSON with a Zod schema; throws 400-friendly errors. */
export function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  return schema.parse(data)
}
