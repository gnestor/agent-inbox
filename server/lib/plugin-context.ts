import { getUserCredential } from "./vault.js"
import { refreshGoogleToken } from "./credentials.js"
import type { PluginContext } from "../../src/types/plugin.js"

type HonoContext = { get: (key: string) => unknown }

export function getWorkspaceId(c: HonoContext): string | undefined {
  return (c.get("workspace") as { id?: string } | undefined)?.id
}

export function getWorkspacePath(c: HonoContext): string | undefined {
  return (c.get("workspace") as { path?: string } | undefined)?.path
}

/**
 * Build a PluginContext from a Hono request context.
 * The auth middleware has already set userEmail on all /api/* routes.
 */
export async function buildPluginContext(c: { get: (key: string) => unknown }): Promise<PluginContext> {
  const userEmail = c.get("userEmail") as string
  return {
    userEmail,
    async getCredential(integration: string): Promise<string | null> {
      const cred = await getUserCredential(userEmail, integration)
      if (cred?.refreshToken) {
        if (integration === "google") {
          return refreshGoogleToken(cred.refreshToken)
        }
        return cred.refreshToken
      }
      return null
    },
  }
}
