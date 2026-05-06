#!/usr/bin/env bash
#
# curate-loop — Repeatedly dispatch entity curation sessions.
#
# Hits POST /api/backfill/curate-entity/next, which picks the entity with the
# most unprocessed sources and launches a background Claude Agent SDK session.
#
# Pause: `touch /tmp/curate.pause` halts the loop without killing it.
#        `rm /tmp/curate.pause` resumes.
#
# Run from the inbox package dir so DATABASE_URL is read from .env:
#   cd packages/inbox && ./scripts/curate-loop.sh

set -u
cd "$(dirname "$0")/.."

DATABASE_URL=$(grep -h DATABASE_URL .env | cut -d= -f2-)
TOKEN=$(psql "$DATABASE_URL" -t -c "SELECT token FROM auth_sessions LIMIT 1" | xargs)

log() { echo "$(date +%FT%T) $*"; }

while true; do
  while [ -f /tmp/curate.pause ]; do
    log "paused (rm /tmp/curate.pause to resume)"
    sleep 60
  done

  result=$(curl -s -m 600 -X POST \
    'http://localhost:3002/api/backfill/curate-entity/next' \
    -b "inbox_session=$TOKEN" -H 'Origin: http://localhost:5175')
  log "$result"
  # Drain-rate polling. Cheap (one DB query + curl per poll, no Claude
  # tokens) and minimizes the gap between session completion and next
  # dispatch. Loosen to 5/30/120/60 once the backlog is drained if the
  # log chatter is annoying.
  case "$result" in
    *sessionId*)             sleep 1 ;;
    *no\ unprocessed*)       sleep 120 ;;
    *holds\ lock*)           sleep 5 ;;
    *)                       sleep 60 ;;
  esac
done
