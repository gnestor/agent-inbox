#!/bin/bash
# Run context curation loops for all sources in parallel.
#
# Each source runs in its own background subshell. The server enforces a
# per-source sequential lock: while a curation session is running, repeated
# calls return `skipped`. Short sleep interval is fine — it's a cheap DB check.
#
# Usage:
#   ./scripts/curate-all.sh                     # run all sources
#   SOURCES="gmail sessions" ./scripts/curate-all.sh   # subset
#   SLEEP_SECONDS=60 ./scripts/curate-all.sh    # custom poll interval
#
# Stop with Ctrl-C — all child loops are terminated.

set -e

HOST="${HOST:-http://localhost:3002}"
SOURCES="${SOURCES:-gmail gorgias sessions slack google-drive notion-tasks notion-calendar}"
SLEEP_SECONDS="${SLEEP_SECONDS:-30}"

# Mint a service JWT for auth (legacy auth_sessions table replaced by stateless JWTs)
if [ -z "${INBOX_SESSION_TOKEN:-}" ]; then
  INBOX_SESSION_TOKEN=$(node --env-file=../../.env --env-file=.env "$(dirname "$0")/mint-token.mjs")
  if [ -z "$INBOX_SESSION_TOKEN" ]; then
    echo "ERROR: failed to mint session token." >&2
    exit 1
  fi
fi

echo "Starting curation loops for: $SOURCES"
echo "Polling every ${SLEEP_SECONDS}s. Press Ctrl-C to stop."
echo ""

# Forward Ctrl-C to all children
trap 'echo "Stopping all loops..."; kill 0' INT TERM

for source in $SOURCES; do
  (
    while true; do
      result=$(curl -s -X POST "${HOST}/api/backfill/curate?source=${source}" \
        -b "hammies_session=${INBOX_SESSION_TOKEN}")
      timestamp=$(date "+%H:%M:%S")
      echo "[$timestamp] [$source] $result"
      sleep "$SLEEP_SECONDS"
    done
  ) &
done

wait
