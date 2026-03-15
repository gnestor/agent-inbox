# Workflow App — Deployment Plan

## Overview

Two-phase deployment strategy: start with the Mac Mini served over Tailscale for internal use, then migrate to Fly.io when multi-user isolation, scale, or API billing becomes necessary.

---

## Phase 1: Mac Mini via Tailscale (Current)

### Architecture

The Mac Mini runs everything in a single process — Hono API server, Vite dev server (or production build), and Agent SDK session subprocesses. Kevin and Grant access the app directly over the Tailscale mesh network with no relay or tunnel overhead.

### Networking

- **Access URL:** `https://grants-mac-mini.tail21f7c3.ts.net` (via Tailscale Serve)
- **Tailscale Serve** proxies port 443 → localhost:5174 with auto-provisioned Let's Encrypt TLS
- **No tunnels needed** — VS Code dev tunnels and Tailscale Funnel both add 500ms+ latency; direct Tailscale peer-to-peer delivers ~30ms TTFB on LAN, ~220ms with TLS
- All users must be on the tailnet; install the **Mac App Store** version of Tailscale (not Homebrew) on macOS clients for proper MagicDNS resolution
- **Vite config** requires `server.host: true` and `server.allowedHosts: true` (or the specific Tailscale hostname)

### Performance Benchmarks

| Path                            | Median TTFB |
|---------------------------------|-------------|
| localhost (Mac Mini)            | <1ms        |
| LAN IP (192.168.x.x)           | ~35ms       |
| Tailscale IP (HTTP, same net)   | ~30ms       |
| Tailscale Serve (HTTPS, same net) | ~220ms   |
| Tailscale Serve (HTTPS, cellular) | ~615ms   |
| VS Code dev tunnel              | ~530ms      |
| Tailscale Funnel                | ~550ms      |

### Authentication

- **App auth:** Google OAuth — redirect URI and JS origins must use the `https://` Tailscale Serve hostname
- **Claude API auth:** `CLAUDE_CODE_OAUTH_TOKEN` env var sourced from macOS Keychain, using Claude Max subscription
- **Per-user workspace credentials:** AES-256-GCM encrypted tokens in PostgreSQL (`user_integrations` table), decrypted by `VAULT_SECRET` env var, injected via transparent HTTPS credential proxy

### Credential Proxy

Runs inside the Hono server process on a random localhost port. Agent subprocesses receive `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, and an opaque `INBOX_SESSION_TOKEN`. The proxy intercepts calls to known API hosts (Notion, Shopify, Slack, GitHub) and injects the user's Authorization header from the vault. Raw OAuth tokens never appear in the agent environment or LLM-visible context.

### Limitations & Risks

- No process isolation between agent sessions — filesystem access across sessions is convention-based, not enforced
- Relies on home network uptime and Mac Mini availability
- Max subscription usage limits assume "ordinary, individual usage" — acceptable for two internal users but not for scaled deployment
- WiFi connection to eero extender adds variability; wired ethernet (940 Mbps up) recommended

### Setup Checklist

- [ ] Ethernet connection to Mac Mini (replace WiFi to eero extender)
- [ ] Tailscale Serve running: `tailscale serve --bg 5174`
- [x] Mac App Store Tailscale on all macOS clients (not Homebrew)
- [x] Tailscale app on phones
- [x] Google OAuth redirect URI updated to Tailscale Serve hostname
- [x] Vite config: `server.host: true`, `server.allowedHosts: true`
- [ ] `CLAUDE_CODE_OAUTH_TOKEN` env var set on Mac Mini
- [ ] `VAULT_SECRET` env var set on Mac Mini
- [ ] `maxTurns` set on Agent SDK sessions and subagent calls

### When to Move to Phase 2

- Onboarding users beyond Grant and Kevin (need multi-user isolation)
- Max subscription becomes insufficient or policy changes
- Need uptime guarantees beyond what home hosting provides
- Webhook-triggered workflow runs (Phase 10 of app plan) create concurrency beyond what a single machine handles

---

## Phase 2: Fly.io Deployment

### Architecture

Split into two layers:

1. **Always-on server VM** — Hono API server, credential proxy, SSE for presence, static frontend assets
2. **Fly Machines (per session)** — Agent SDK processes spawned on demand, isolated per session

This maps to the Agent SDK's **Hybrid Sessions** pattern: ephemeral containers hydrated with state from PostgreSQL and session resumption, spinning down when idle.

### Server VM

- Runs the Hono server, handles auth, API routes, WebSocket connections from clients
- Hosts the credential proxy — agent machines route API traffic back through the server over Fly's private network (`.internal` DNS)
- Manages agent machine lifecycle via the Fly Machines REST API
- Stores app-level secrets via `flyctl secrets set`: `ANTHROPIC_API_KEY`, `VAULT_SECRET`, `DATABASE_URL`, Google OAuth client ID/secret

### Agent Machines

- Spawned per session, destroyed on completion or idle timeout
- Docker image with Node.js + Claude Code CLI pre-installed
- Git workspace cloned from repo on machine creation (not shared volumes — volumes can only attach to one machine)
- Env vars injected per-machine at creation: `HTTPS_PROXY` (server internal address), `NODE_EXTRA_CA_CERTS`, `INBOX_SESSION_TOKEN` (short-lived, scoped to user)
- Never receive `VAULT_SECRET` or raw OAuth tokens
- ~300ms cold start

### Authentication

- **Claude API:** `ANTHROPIC_API_KEY` from console.anthropic.com, set via `flyctl secrets set` — OAuth tokens from Max subscription are not permitted for deployed Agent SDK usage
- **Per-user credentials:** Same vault pattern as Phase 1, but proxy runs on the server VM and agent machines route through it over Fly's internal network

### Credential Flow

1. Agent machine sends HTTPS request to Notion/Shopify/etc.
2. Request routed via `HTTPS_PROXY` to server VM's credential proxy
3. Proxy looks up user via `INBOX_SESSION_TOKEN` → decrypts token from `user_integrations` → injects Authorization header
4. Proxy forwards request to destination API
5. **Note:** Node.js `fetch()` ignores `HTTPS_PROXY` by default; requires `NODE_USE_ENV_PROXY=1` (Node 24+) or `global-agent` library

### Communication

- Client connects via WebSocket to server VM
- Server routes messages to the appropriate agent machine over Fly's internal network
- Alternative: client connects directly to agent machine via Fly's proxy using `fly-force-instance-id` header (lower latency but requires agent machine to validate auth tokens)

### Local Development

- No Fly Machines emulator exists locally
- Use Docker as stand-in: `SessionRunner` interface with two implementations — `DockerSessionRunner` (local) and `FlyMachineSessionRunner` (production)
- Docker containers use same image, env vars, and network topology (Docker bridge network mirrors Fly internal network)
- Credential proxy runs on server container, agent containers route through it

### Cost Considerations

- **Compute:** Fly Machines ~$0.05/hr minimum per running machine; server VM always-on
- **API tokens:** Per-token billing replaces flat Max subscription — Sonnet ~$3/$15 per 1M input/output tokens
- **Database:** Existing EC2 PostgreSQL, ~20-50ms latency from Fly

### Estimated Build Effort

| Component                          | Estimate   |
|------------------------------------|------------|
| Machine lifecycle (spawn/stop/cleanup) | 2-3 days |
| Communication layer (server ↔ machines) | 2-3 days |
| Credential proxy routing over internal network | 1-2 days |
| Git workspace hydration on machine start | 1-2 days |
| Docker-based local dev parity      | 1-2 days   |
| Edge cases, monitoring, cleanup    | 2-3 days   |
| **Total**                          | **~2 weeks** |

### Key References

- [Hosting the Agent SDK](https://platform.claude.com/docs/en/agent-sdk/hosting) — deployment patterns and sandbox providers
- [Securely deploying AI agents](https://platform.claude.com/docs/en/agent-sdk/secure-deployment) — credential proxy pattern, isolation technologies, filesystem configuration
- [Fly Machines API](https://fly.io/docs/machines/) — machine lifecycle management
