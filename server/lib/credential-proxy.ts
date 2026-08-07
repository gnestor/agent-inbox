import { createServer, type Server, type IncomingMessage } from "node:http"
import { connect as tlsConnect, createServer as createTlsServer } from "node:tls"
import { Socket } from "node:net"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { generateCA, generateCertForHost, writeCACertFile } from "./credential-proxy-ca.js"
import { createLogger } from "@hammies/frontend/lib/serverLogger"
import {
  resolveHostRule,
  shouldIntercept as sharedShouldIntercept,
  interceptedHosts,
  formatAuthHeader,
  formatAdditionalHeaders,
  type ProxyRule,
  type ResolvedCredential,
} from "@hammies/auth/server"

const log = createLogger("credential-proxy")

const PRELOAD_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "agent-proxy-preload.mjs")

/**
 * Hosts where the proxy will intercept and inject credentials, plus which
 * integration/auth-method a given host maps to, are NOT a hardcoded list here
 * anymore — they are derived from the live `@hammies/auth` integration
 * registry (each plugin's `studio.integrations[].proxy` declaration), the same
 * source Studio's own credential proxy resolves via `resolveHostRule`
 * (packages/studio/src/server/credentials/proxy.ts). A per-package host map
 * drifts from the registry the moment a plugin adds or narrows a host pattern
 * — the previous hardcoded `googleapis.com` catch-all here silently absorbed
 * `googleads.googleapis.com` traffic meant for the `google-ads` integration
 * (its own credential, plus a `developer-token` header) and `bigquery`/
 * `analyticsdata`/`gmail`/`calendar`/`sheets` traffic meant for other, distinct
 * Google integrations — injecting the `google` service-account row's raw
 * stored value (unmintable, unusable JSON) for all of them.
 */
export function interceptedProxyHosts(rules?: readonly ProxyRule[]): string[] {
  return interceptedHosts(rules)
}

export function shouldIntercept(host: string, rules?: readonly ProxyRule[]): boolean {
  return sharedShouldIntercept(host, rules)
}

/**
 * Map an intercepted host to its vault integration name via the registry's
 * per-host proxy rules — the most specific matching pattern wins (an exact
 * host beats a subdomain match, a deeper subdomain beats a shallower one), so
 * `generativelanguage.googleapis.com` resolves to `gemini` and
 * `googleads.googleapis.com` resolves to `google-ads` even though the broader
 * `googleapis.com`-style patterns other Google integrations declare also
 * match as a suffix. Returns the host itself when no rule matches —
 * `shouldIntercept` gates entry into the MITM branch, so in practice this is
 * a defensive fallback, not a real path.
 */
export function hostToIntegration(host: string, rules?: readonly ProxyRule[]): string {
  const resolved = resolveHostRule(host, undefined, rules)
  return resolved.status === "matched" ? resolved.integration : host
}

export type { ResolvedCredential }

export interface CredentialProxyOptions {
  /**
   * Given a session token (extracted from the Proxy-Authorization header, which
   * HTTP clients set automatically from the userinfo in the proxy URL) and an
   * integration name, resolve the credential from the vault. Return null if not
   * found.
   */
  resolveCredential: (sessionToken: string, integration: string) => Promise<ResolvedCredential | null>
}

export interface CredentialProxy {
  port: number
  caCertPath: string
  close: () => Promise<void>
  getProxyEnv: (sessionToken: string) => Record<string, string>
}

export async function createCredentialProxy(
  options: CredentialProxyOptions
): Promise<CredentialProxy> {
  const ca = await generateCA()
  const caCertPath = await writeCACertFile()

  const server: Server = createServer()

  // Handle HTTP CONNECT method (HTTPS proxy tunnel)
  server.on("connect", async (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    const parts = (req.url || "").split(":")
    const host = parts[0] ?? ""
    const port = parseInt(parts[1] ?? "443", 10)

    const resolution = resolveHostRule(host, undefined)

    if (resolution.status === "unmatched") {
      // Transparent tunnel — connect directly to the remote server
      const remote = new Socket()
      remote.connect(port, host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        remote.write(head)
        remote.pipe(clientSocket)
        clientSocket.pipe(remote)
      })
      remote.on("error", () => clientSocket.destroy())
      clientSocket.on("error", () => remote.destroy())
      return
    }

    if (resolution.status !== "matched") {
      // "ambiguous" — two registered integrations declare the same host at
      // equal specificity. Refusing beats guessing which credential to
      // inject (mirrors Studio's credential proxy, packages/studio/src/
      // server/credentials/proxy.ts).
      clientSocket.end(
        "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n" +
          `X-Credential-Proxy-Error: ${resolution.status}\r\n\r\n`,
      )
      return
    }

    // MITM intercept — terminate TLS with a cert for this host
    const hostCert = await generateCertForHost(host, ca)
    const integration = resolution.integration
    const inject = resolution.inject
    const headerRules = resolution.headers

    // Extract session token from the Proxy-Authorization header.
    // HTTP clients automatically set this from the userinfo in the proxy URL
    // (e.g., HTTPS_PROXY=http://{token}@127.0.0.1:{port}).
    // The header value is "Basic base64(token:)" since userinfo is user:pass format.
    const proxyAuth = req.headers["proxy-authorization"] || ""
    const sessionToken = proxyAuth.startsWith("Basic ")
      ? Buffer.from(proxyAuth.slice(6), "base64").toString().replace(/:$/, "")
      : proxyAuth.replace(/^Bearer\s+/i, "")

    const tlsServer = createTlsServer(
      { key: hostCert.key, cert: hostCert.cert },
      (tlsSocket) => {
        // Read the decrypted HTTP request from the agent
        let rawData = ""
        let handled = false
        tlsSocket.on("data", async (chunk) => {
          rawData += chunk.toString()

          // Wait for headers to be complete
          if (!rawData.includes("\r\n\r\n")) return
          if (handled) return
          handled = true
          tlsSocket.pause()

          // Parse HTTP request
          const headerEnd = rawData.indexOf("\r\n\r\n")
          const headerSection = rawData.slice(0, headerEnd)
          const body = rawData.slice(headerEnd + 4)
          const lines = headerSection.split("\r\n")
          const requestLine = lines[0] ?? ""

          // Resolve credential from vault
          const cred = sessionToken
            ? await options.resolveCredential(sessionToken, integration)
            : null

          let finalRequestLine = requestLine

          // For query-param auth, inject/replace the param in the URL
          if (cred && inject.kind === "query") {
            const match = requestLine.match(/^(\S+)\s+(\S+)\s+(\S+)$/)
            if (match) {
              const [, method, rawUrl, httpVersion] = match as [string, string, string, string]
              const url = new URL(rawUrl, `https://${host}`)
              url.searchParams.set(inject.param, cred.token)
              finalRequestLine = `${method} ${url.pathname}${url.search} ${httpVersion}`
            }
          }

          // Config-backed extra headers (e.g. Google Ads' `developer-token`),
          // resolved by the caller's resolveCredential into `cred.extras`.
          const additionalHeaders = cred ? formatAdditionalHeaders(headerRules, cred) : []
          const additionalHeaderNames = new Set((headerRules ?? []).map(({ header }) => header.toLowerCase()))

          // Rebuild headers with credential injection
          const newHeaders: string[] = [finalRequestLine]
          const authHeaderName = inject.kind === "header" ? inject.header.toLowerCase() : "authorization"
          let injected = false

          for (let i = 1; i < lines.length; i++) {
            const lowerLine = lines[i]!.toLowerCase()
            const currentHeaderName = lowerLine.slice(0, lowerLine.indexOf(":"))
            if (cred && additionalHeaderNames.has(currentHeaderName)) {
              // Dropped: the config-backed value pushed below replaces
              // whatever the caller sent (a placeholder, or nothing).
              continue
            }
            if (cred && lowerLine.startsWith(`${authHeaderName}:`)) {
              // Replace existing header with the real credential
              newHeaders.push(formatAuthHeader(inject, cred))
              injected = true
            } else {
              newHeaders.push(lines[i]!)
            }
          }

          // Add header if it wasn't already present (bearer/header/basic only)
          if (cred && !injected && inject.kind !== "query") {
            newHeaders.push(formatAuthHeader(inject, cred))
          }
          newHeaders.push(...additionalHeaders)

          // Connect to the real server
          const realSocket = tlsConnect(
            { host, port, servername: host },
            () => {
              realSocket.write(newHeaders.join("\r\n") + "\r\n\r\n" + body)
            }
          )

          realSocket.pipe(tlsSocket)
          tlsSocket.resume()
          tlsSocket.pipe(realSocket)

          realSocket.on("error", () => tlsSocket.destroy())
          tlsSocket.on("error", () => realSocket.destroy())
        })
      }
    )

    // Clean up TLS server when the client disconnects
    clientSocket.once("close", () => tlsServer.close())

    // Send 200 BEFORE emitting the TLS connection — otherwise the client
    // hasn't received the tunnel confirmation yet when the TLS handshake starts,
    // causing a race condition.
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    tlsServer.emit("connection", clientSocket)
    if (head.length > 0) {
      clientSocket.unshift(head)
    }
  })

  return new Promise((resolve, reject) => {
    // Listen on a random port on localhost only
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to bind proxy server"))
        return
      }

      const proxy: CredentialProxy = {
        port: addr.port,
        caCertPath,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res())
          }),
        getProxyEnv: (sessionToken: string) => ({
          HTTPS_PROXY: `http://${sessionToken}@127.0.0.1:${addr.port}`,
          NODE_EXTRA_CA_CERTS: caCertPath,
          // Bypass the proxy for Anthropic API + telemetry hosts. The credential
          // proxy only adds value for intercepted integration hosts (notion, github,
          // etc); for api.anthropic.com it just transparent-tunnels — and the Bun-
          // compiled native binary in @anthropic-ai/claude-agent-sdk ≥0.2.138 fails
          // that tunnel with a spurious "ConnectionRefused" / "FailedToOpenSocket".
          // Direct connect lets the binary reach the API normally (auth via keychain).
          NO_PROXY: ".anthropic.com,statsig.anthropic.com,api.githubcopilot.com,http-intake.logs.us5.datadoghq.com",
          // Preload sets up undici's global dispatcher so all fetch() calls in
          // agent subprocesses are routed through the credential proxy without
          // any skill-level configuration. Append to preserve any existing options.
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ? process.env.NODE_OPTIONS + " " : ""}--import "${PRELOAD_SCRIPT}"`,
        }),
      }

      resolve(proxy)
    })

    server.on("error", reject)
  })
}
