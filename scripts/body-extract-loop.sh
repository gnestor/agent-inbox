#!/usr/bin/env bash
#
# body-extract-loop — Repeatedly extract clean bodies from raw stubs.
#
# Hits POST /api/backfill/extract-bodies, which calls the local Ollama model
# (qwen3.5:4b by default) to compress noisy raw bodies into clean prose.
#
# Pause: `touch /tmp/body-extract.pause`.
#
# Run from the inbox package dir so DATABASE_URL is read from .env:
#   cd packages/inbox && ./scripts/body-extract-loop.sh

set -u
cd "$(dirname "$0")/.."

DATABASE_URL=$(grep -h DATABASE_URL .env | cut -d= -f2-)
TOKEN=$(psql "$DATABASE_URL" -t -c "SELECT token FROM auth_sessions LIMIT 1" | xargs)

log() { echo "$(date +%FT%T) $*"; }

LIMIT=${LIMIT:-50}

while true; do
  while [ -f /tmp/body-extract.pause ]; do
    log "paused (rm /tmp/body-extract.pause to resume)"
    sleep 60
  done

  result=$(curl -s -m 1200 -X POST \
    "http://localhost:3002/api/backfill/extract-bodies?limit=$LIMIT" \
    -b "inbox_session=$TOKEN" -H 'Origin: http://localhost:5175')
  log "$result"

  # Backoff if no work queued, otherwise tight loop.
  case "$result" in
    *processed*0*)           sleep 120 ;;
    *processed*)             sleep 5 ;;
    *)                       sleep 60 ;;
  esac
done
