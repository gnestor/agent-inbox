#!/usr/bin/env bash
#
# gorgias-rerender-loop — Re-apply current itemToContext + enrichForContext
# to existing Gorgias stubs so they pick up new rendering logic without a
# full backfill_state reset.
#
# Hits POST /api/backfill/gorgias/re-render?limit=N&skip=N. Walks the
# existing context/gorgias/*.md files in sorted order; resume by setting SKIP.
#
# Pause: `touch /tmp/gorgias-rerender.pause`.
#
# Usage:
#   cd packages/inbox && SKIP=1140 BATCH=20 ./scripts/gorgias-rerender-loop.sh

set -u
cd "$(dirname "$0")/.."

DATABASE_URL=$(grep -h DATABASE_URL .env | cut -d= -f2-)
TOKEN=$(psql "$DATABASE_URL" -t -c "SELECT token FROM auth_sessions LIMIT 1" | xargs)

log() { echo "$(date +%FT%T) $*"; }

BATCH=${BATCH:-20}
SKIP=${SKIP:-0}

log "Starting gorgias re-render loop. batch=$BATCH skip=$SKIP"

while true; do
  while [ -f /tmp/gorgias-rerender.pause ]; do
    log "paused (rm /tmp/gorgias-rerender.pause to resume)"
    sleep 60
  done

  result=$(curl -s -m 600 -X POST \
    "http://localhost:3002/api/backfill/gorgias/re-render?limit=$BATCH&skip=$SKIP" \
    -b "inbox_session=$TOKEN" -H 'Origin: http://localhost:5175')
  log "skip=$SKIP result=$result"

  total=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total', 0))" 2>/dev/null || echo 0)
  nextSkip=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('nextSkip', 0))" 2>/dev/null || echo 0)

  if [ "$total" = "0" ] || [ "$nextSkip" = "0" ]; then
    log "no progress; sleeping 5 min (server may be reloading)"
    sleep 300
    continue
  fi

  if [ "$nextSkip" -ge "$total" ]; then
    log "done — re-rendered all $total stubs"
    break
  fi

  SKIP=$nextSkip
  sleep 5
done
