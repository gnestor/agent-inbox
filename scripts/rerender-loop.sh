#!/usr/bin/env bash
#
# rerender-loop — Re-apply current itemToContext + enrichForContext to
# existing stubs for any plugin so they pick up new rendering logic
# without resetting backfill_state.
#
# Hits POST /api/backfill/$PLUGIN_ID/re-render?limit=N&skip=N. Walks the
# existing context/$PLUGIN_ID/*.md files in sorted order; resume via SKIP.
#
# Pause: `touch /tmp/$PLUGIN_ID-rerender.pause`.
#
# Usage:
#   cd packages/inbox && PLUGIN_ID=gorgias       BATCH=20 SKIP=0 ./scripts/rerender-loop.sh
#   cd packages/inbox && PLUGIN_ID=gmail         BATCH=20 SKIP=0 ./scripts/rerender-loop.sh
#   cd packages/inbox && PLUGIN_ID=slack         BATCH=20 SKIP=0 ./scripts/rerender-loop.sh
#   cd packages/inbox && PLUGIN_ID=google-drive  BATCH=20 SKIP=0 ./scripts/rerender-loop.sh

set -u
cd "$(dirname "$0")/.."

PLUGIN_ID=${PLUGIN_ID:-gorgias}
BATCH=${BATCH:-20}
SKIP=${SKIP:-0}
PAUSE_FILE=${PAUSE_FILE:-/tmp/${PLUGIN_ID}-rerender.pause}

DATABASE_URL=$(grep -h DATABASE_URL .env | cut -d= -f2-)
TOKEN=$(psql "$DATABASE_URL" -t -c "SELECT token FROM auth_sessions LIMIT 1" | xargs)

log() { echo "$(date +%FT%T) [$PLUGIN_ID] $*"; }

log "Starting re-render loop. batch=$BATCH skip=$SKIP"

while true; do
  while [ -f "$PAUSE_FILE" ]; do
    log "paused (rm $PAUSE_FILE to resume)"
    sleep 60
  done

  result=$(curl -s -m 600 -X POST \
    "http://localhost:3002/api/backfill/$PLUGIN_ID/re-render?limit=$BATCH&skip=$SKIP" \
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
