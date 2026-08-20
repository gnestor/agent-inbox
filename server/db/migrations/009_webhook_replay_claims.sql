-- Durable, cross-instance webhook replay protection. The primary key makes a
-- claim atomic; expires_at allows an event id to be reclaimed after retention.
CREATE TABLE IF NOT EXISTS webhook_replay_claims (
  event_id    TEXT PRIMARY KEY,
  expires_at  TIMESTAMPTZ NOT NULL,
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_replay_claims_expires_at_idx
  ON webhook_replay_claims (expires_at);
