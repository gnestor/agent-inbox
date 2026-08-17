import { z } from "zod"
import { execute } from "./pool.js"
import { queryOptionalRow } from "./rows.js"

const CLAIM_TTL_MS = 86_400_000

const ClaimedEventRowSchema = z.object({
  event_id: z.string().min(1),
}).strict()

export async function claimWebhookEvent(eventId: string, now: number): Promise<boolean> {
  const nowDate = new Date(now)
  const expiresAt = new Date(now + CLAIM_TTL_MS)

  await execute(
    "DELETE FROM webhook_replay_claims WHERE expires_at <= $1",
    [nowDate],
  )

  const claimed = await queryOptionalRow(
    ClaimedEventRowSchema,
    "claim-webhook-event",
    `INSERT INTO webhook_replay_claims (event_id, expires_at)
       VALUES ($1, $2)
       ON CONFLICT (event_id) DO UPDATE
         SET expires_at = EXCLUDED.expires_at,
             claimed_at = NOW()
       WHERE webhook_replay_claims.expires_at <= $3
       RETURNING event_id`,
    [eventId, expiresAt, nowDate],
  )

  return claimed !== undefined
}
