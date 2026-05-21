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
TOKEN=$(node --env-file=../../.env --env-file=.env "$(dirname "$0")/mint-token.mjs")

log() { echo "$(date +%FT%T) $*"; }

LIMIT=${LIMIT:-50}
SOURCES=(${SOURCES:-gorgias gmail google-drive notion slack sessions})

while true; do
  while [ -f /tmp/body-extract.pause ]; do
    log "paused (rm /tmp/body-extract.pause to resume)"
    sleep 60
  done

  any_processed=0
  for source in "${SOURCES[@]}"; do
    result=$(curl -s -m 1200 -X POST \
      "http://localhost:3002/api/backfill/extract-bodies?source=$source&limit=$LIMIT" \
      -b "hammies_session=$TOKEN" -H 'Origin: http://localhost:5175')
    log "[$source] $result"
    # Track whether any source had work; only back off when all are idle.
    case "$result" in
      *'"extracted":0'*) ;;
      *'"extracted"'*)   any_processed=1 ;;
    esac
  done

  if [ "$any_processed" = "0" ]; then
    sleep 120
  else
    sleep 5
  fi
done
