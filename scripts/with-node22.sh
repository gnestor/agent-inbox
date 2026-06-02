#!/usr/bin/env bash
#
# Run a command under Node 22 LTS.
#
# WHY: the inbox server spawns Claude agent subprocesses via
# @anthropic-ai/claude-agent-sdk. When a credential proxy is active the SDK
# sets HTTPS_PROXY, which makes its *bundled* undici build the proxy
# dispatcher while the request is driven by the host Node's *built-in* undici.
# On Node 26 (built-in undici 8.x) the two dispatch-handler interfaces are
# incompatible and every API call fails synchronously with
# `InvalidArgumentError: invalid onError method` (surfaced to users as
# "API Error: Unable to connect to API (UND_ERR_INVALID_ARG)"). Node 22's
# built-in undici matches the bundled version's handler interface, so the
# proxy path works. Pinning the server to Node 22 cascades to the agent
# subprocesses it spawns (they resolve `node` from this PATH).
#
# Both the server and the spawned agents must run on Node 22 until the SDK
# ships a fix for the Node 26 / undici 8 mismatch.
set -euo pipefail

NODE22_BIN="$(brew --prefix node@22 2>/dev/null || echo /opt/homebrew/opt/node@22)/bin"

if [ ! -x "$NODE22_BIN/node" ]; then
  echo "error: Node 22 LTS not found at $NODE22_BIN/node" >&2
  echo "       Install it with:  brew install node@22" >&2
  echo "       (inbox must run on Node 22 — Node 26's undici breaks the agent SDK proxy path)" >&2
  exit 1
fi

export PATH="$NODE22_BIN:$PATH"
exec "$@"
