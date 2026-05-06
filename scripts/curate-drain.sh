#!/usr/bin/env bash
#
# curate-drain — Run K curate-entity dispatches in parallel until the queue is empty.
#
# Pulls the top-K distinct unprocessed entities from source_entities and
# dispatches each one to POST /api/backfill/curate-entity?entity=X&type=T,
# which uses a per-entity lock so K different entities run concurrently.
#
# Calling /api/backfill/curate-entity/next K times in parallel does NOT work —
# the picker returns the same top entity every time, and K-1 workers collide
# on its lock. Use this script for parallel drain instead.
#
# Defaults to 3 parallel workers. Override with PARALLEL=N.
#
# Pause: `touch /tmp/curate.pause` halts the loop without killing it.
#
# Run from the inbox package dir:
#   cd packages/inbox && ./scripts/curate-drain.sh
#   PARALLEL=5 ./scripts/curate-drain.sh

set -u
cd "$(dirname "$0")/.."

DATABASE_URL=$(grep -h DATABASE_URL .env | cut -d= -f2-)
TOKEN=$(psql "$DATABASE_URL" -t -c "SELECT token FROM auth_sessions LIMIT 1" | xargs)
PARALLEL="${PARALLEL:-3}"
WORKSPACE_ID="${WORKSPACE_ID:-agent}"

log() { echo "$(date +%FT%T) [drain] $*"; }

# Fetch top-K distinct unprocessed entities ordered the same way the
# curate-entity/next picker would (domain → company → person → project →
# product → folder → other; then by source count desc).
fetch_top_entities() {
  local k="$1"
  psql "$DATABASE_URL" -tA -F$'\t' -c "
    SELECT entity_type, entity_value
    FROM source_entities
    WHERE workspace_id = '$WORKSPACE_ID' AND processed_for_entity = 0
    GROUP BY entity_type, entity_value
    ORDER BY
      CASE entity_type
        WHEN 'domain' THEN 0
        WHEN 'company' THEN 1
        WHEN 'person' THEN 2
        WHEN 'project' THEN 3
        WHEN 'product' THEN 4
        WHEN 'folder' THEN 5
        ELSE 6
      END,
      COUNT(*) DESC
    LIMIT $k;
  "
}

# URL-encode a value for use in a query string.
urlencode() {
  python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1"
}

dispatch_entity() {
  local id="$1"
  local etype="$2"
  local evalue="$3"
  local enc_value
  enc_value=$(urlencode "$evalue")
  local result
  result=$(curl -s -m 600 -X POST \
    "http://localhost:3002/api/backfill/curate-entity?type=${etype}&value=${enc_value}" \
    -b "inbox_session=$TOKEN" -H 'Origin: http://localhost:5175')
  echo "$(date +%FT%T) [worker-$id] ${etype}:${evalue} -> $result"
}

log "Starting drain with PARALLEL=$PARALLEL workers, workspace=$WORKSPACE_ID"

idle_iterations=0
while true; do
  while [ -f /tmp/curate.pause ]; do
    log "paused (rm /tmp/curate.pause to resume)"
    sleep 60
  done

  # Pull more than K candidates so a few collisions on already-locked
  # entities don't fully waste an iteration. Workers race through the
  # candidate list, claiming the first lock that's free.
  candidates=$(fetch_top_entities $((PARALLEL * 3)))

  if [ -z "$candidates" ]; then
    idle_iterations=$((idle_iterations + 1))
    log "queue empty (idle iteration $idle_iterations/3)"
    if [ "$idle_iterations" -ge 3 ]; then
      log "queue drained — exiting"
      break
    fi
    sleep 30
    continue
  fi
  idle_iterations=0

  # Dispatch up to PARALLEL distinct entities.
  pids=()
  i=0
  while IFS=$'\t' read -r etype evalue; do
    [ -z "$etype" ] && continue
    i=$((i + 1))
    dispatch_entity "$i" "$etype" "$evalue" &
    pids+=($!)
    if [ "$i" -ge "$PARALLEL" ]; then break; fi
    sleep 0.2
  done <<< "$candidates"

  # Wait for all dispatches to return. Each call blocks until the SDK
  # session is dispatched (fast) or until 600s — whichever comes first.
  # The session itself runs in the background on the server.
  for pid in "${pids[@]}"; do
    wait "$pid" || true
  done

  unprocessed=$(psql "$DATABASE_URL" -tA -c "SELECT COUNT(*) FROM source_entities WHERE workspace_id = '$WORKSPACE_ID' AND processed_for_entity = 0;")
  log "unprocessed pairs remaining: $unprocessed"

  # Brief breather so dispatched sessions can grab their locks before the
  # next fan-out tries to claim more.
  sleep 5
done
