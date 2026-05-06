/**
 * Shared lifecycle for background curation sessions.
 *
 * Both the per-source curator (context-backfill-scheduler) and the per-entity
 * curator (entity-curator) run Claude sessions that:
 *  - Use CWD = `{workspace}/context` so JSONL files live in a dedicated Agent
 *    SDK project directory.
 *  - Skip creating a row in the `sessions` table.
 *  - Track their own lifecycle via `backfill_state` pending rows.
 *
 * This helper claims the pending row atomically (before `startSession`),
 * survives server crashes via a stale-lock TTL, and invokes `onComplete`
 * exactly once when the session's message loop finishes successfully.
 */

import { join } from "path"
import { queryOne, execute } from "../db/pool.js"
import { startSession } from "./session-manager.js"

/** Curation sessions run with CWD = `{workspace}/context`. */
export function getCurationCwd(workspacePath: string): string {
  return join(workspacePath, "context")
}

/** A pending lock is abandoned if not cleared within this window. */
const STALE_LOCK_MS = 60 * 60 * 1000

/**
 * Delete all `entity-curation:*:pending` rows whose `last_run_at` exceeds
 * the stale-lock threshold. The dispatch path also clears stale locks on
 * re-dispatch attempts, but locks for entities nobody re-tries (e.g. one
 * that finished extraction and never had a follow-up source) sit forever.
 * Run this periodically to keep the queue from getting stuck behind orphan
 * locks left by crashed/aborted sessions.
 *
 * Returns the number of rows deleted.
 */
export async function cleanupStaleCurationLocks(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString()
  const result = await execute(
    `DELETE FROM backfill_state
     WHERE plugin_id LIKE 'entity-curation:%:pending'
       AND last_run_at < $1`,
    [cutoff],
  )
  return result.rowCount ?? 0
}

type RunResult =
  | { sessionId: string }
  | { skipped: string }
  | { error: string }

/**
 * Default model for background curation sessions. Curation is a structured,
 * tool-heavy task (Read + Edit + Glob + Grep) that Haiku 4.5 handles fine.
 * Switching off the default Sonnet recovers ~5× on the Sonnet weekly quota.
 *
 * Override via `CURATION_MODEL` env var.
 */
const DEFAULT_CURATION_MODEL = process.env.CURATION_MODEL ?? "claude-haiku-4-5-20251001"

export async function runBackgroundCurationSession(opts: {
  workspacePath: string
  workspaceId: string
  pendingKey: string
  prompt: string
  linkedItemTitle: string
  onComplete: () => void | Promise<void>
  /** Override the model. Defaults to Haiku 4.5 (or `CURATION_MODEL` env). */
  model?: string
}): Promise<RunResult> {
  const { workspacePath, workspaceId, pendingKey, prompt, linkedItemTitle, onComplete } = opts
  const model = opts.model ?? DEFAULT_CURATION_MODEL

  // Clear any stale lock before attempting to claim.
  const existing = await queryOne<{ last_cursor: string | null; last_run_at: string }>(
    "SELECT last_cursor, last_run_at FROM backfill_state WHERE plugin_id = $1 AND workspace_id = $2",
    [pendingKey, workspaceId],
  )
  if (existing) {
    const age = Date.now() - new Date(existing.last_run_at).getTime()
    if (age < STALE_LOCK_MS) {
      const sid = (existing.last_cursor ?? "").split("|")[0] || "unknown"
      return { skipped: `pending session ${sid} still holds lock (age ${Math.round(age / 1000)}s)` }
    }
    await execute(
      "DELETE FROM backfill_state WHERE plugin_id = $1 AND workspace_id = $2",
      [pendingKey, workspaceId],
    )
  }

  // Atomic claim: only one caller can INSERT first.
  const now = new Date().toISOString()
  const claim = await execute(
    `INSERT INTO backfill_state (plugin_id, workspace_id, last_cursor, last_run_at, total_indexed, updated_at)
     VALUES ($1, $2, $3, $4, 0, $4)
     ON CONFLICT (plugin_id, workspace_id) DO NOTHING`,
    [pendingKey, workspaceId, "claiming", now],
  )
  if (claim.rowCount === 0) {
    return { skipped: "another caller claimed the lock first" }
  }

  const releasePendingRow = () =>
    execute(
      "DELETE FROM backfill_state WHERE plugin_id = $1 AND workspace_id = $2",
      [pendingKey, workspaceId],
    )

  try {
    const sessionId = await startSession(prompt, {
      workspacePath: getCurationCwd(workspacePath),
      skipDbRecord: true,
      linkedItemTitle,
      model,
      onEnd: async (sid, status) => {
        try {
          if (status === "complete") {
            await onComplete()
          }
        } finally {
          await releasePendingRow()
        }
      },
    })

    // Upgrade the claim cursor with the real session ID so operators can
    // trace what's holding the lock.
    await execute(
      `UPDATE backfill_state SET last_cursor = $1, updated_at = $2
       WHERE plugin_id = $3 AND workspace_id = $4`,
      [sessionId, new Date().toISOString(), pendingKey, workspaceId],
    )

    return { sessionId }
  } catch (err) {
    await releasePendingRow().catch(() => {})
    return { error: (err as Error).message }
  }
}
