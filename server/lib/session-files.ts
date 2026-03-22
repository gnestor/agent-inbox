import { mkdirSync, existsSync, writeFileSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { getWorkspacePath } from "./session-manager.js"

/**
 * Per-session file directories.
 *
 * Convention: $WORKSPACE_ROOT/sessions/{sessionId}/{input,output}/
 *
 * - input/  — files uploaded by the user via POST /api/sessions/:id/files
 * - output/ — files written by the agent (referenced in render_output file specs)
 */

const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`)
  }
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._\- ]/g, "_")
}

function getSessionsRoot(): string {
  const workspace = getWorkspacePath() || process.cwd()
  return join(workspace, "sessions")
}

export function getSessionFilesDir(sessionId: string, subfolder: "input" | "output" = "input"): string {
  validateSessionId(sessionId)
  const dir = join(getSessionsRoot(), sessionId, subfolder)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function saveSessionFile(
  sessionId: string,
  filename: string,
  data: Buffer,
  mimeType = "application/octet-stream",
): { name: string; path: string; size: number; mimeType: string } {
  const dir = getSessionFilesDir(sessionId, "input")
  const safe = sanitizeFilename(filename)
  const filePath = join(dir, safe)
  writeFileSync(filePath, data)
  return { name: safe, path: filePath, size: data.length, mimeType }
}

export function getSessionFilePath(
  sessionId: string,
  filename: string,
): string | null {
  validateSessionId(sessionId)
  const safe = sanitizeFilename(filename)
  for (const subfolder of ["input", "output"] as const) {
    const dir = join(getSessionsRoot(), sessionId, subfolder)
    const filePath = join(dir, safe)
    if (existsSync(filePath)) {
      return filePath
    }
  }
  return null
}

/** List all files in a session (both input and output) */
export function listSessionFiles(sessionId: string): Array<{ name: string; size: number; subfolder: string }> {
  validateSessionId(sessionId)
  const result: Array<{ name: string; size: number; subfolder: string }> = []
  for (const subfolder of ["input", "output"] as const) {
    const dir = join(getSessionsRoot(), sessionId, subfolder)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const filePath = join(dir, name)
      try {
        const { size } = statSync(filePath)
        result.push({ name, size, subfolder })
      } catch { /* skip */ }
    }
  }
  return result
}

/** Build a file manifest string to prepend to the session system prompt */
export function buildFileManifest(sessionId: string): string {
  const files = listSessionFiles(sessionId)
  if (files.length === 0) return ""
  const lines = files.map((f) => `- ${f.name} (${f.subfolder}/, ${f.size} bytes)`)
  return `\nSession files:\n${lines.join("\n")}\n`
}
