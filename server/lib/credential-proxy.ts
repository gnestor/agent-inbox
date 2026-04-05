import { createServer, type Server, type IncomingMessage } from "node:http"
import { connect as tlsConnect, createServer as createTlsServer } from "node:tls"
import { Socket } from "node:net"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { generateCA, generateCertForHost, writeCACertFile } from "./credential-proxy-ca.js"
import { createLogger } from "./logger.js"

const log = createLogger("credential-proxy")

const PRELOAD_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "agent-proxy-preload.mjs")

/**
 * Hosts where the proxy will intercept and inject credentials.
 * Requests to other hosts pass through as a transparent tunnel.
 */
export const INTERCEPTED_HOSTS = [
  "api.notion.com",
  "api.github.com",
  "slack.com",
  "api.slack.com",
  "hooks.slack.com",
  "shopify.com",                    // *.shopify.com via endsWith check
  "googleapis.com",                 // *.googleapis.com via endsWith check
  "api.air.inc",
  "quickbooks.api.intuit.com",
  "sandbox-quickbooks.api.intuit.com",
  "a.klaviyo.com",
  "graph.facebook.com",
  "gorgias.com",                    // *.gorgias.com via endsWith check
  "api.pinterest.com",
]

export function shouldIntercept(host: string): boolean {
  return INTERCEPTED_HOSTS.some(
    (h) => host === h || host.endsWith(`.${h}`)
  )
}

/**
 * Map intercepted host to the integration name used in the vault.
 * Order matters: specific subdomains must be checked before catch-all patterns.
 */
export function hostToIntegration(host: string): string {
  if (host === "api.notion.com") return "notion"
  if (host === "api.github.com") return "github"
  if (host.includes("slack.com")) return "slack"
  if (host.includes("shopify.com")) return "shopify"
  if (host === "generativelanguage.googleapis.com") return "gemini"
  if (host.includes("googleapis.com")) return "google"
  if (host === "api.air.inc") return "air"
  if (host.includes("quickbooks.api.intuit.com")) return "quickbooks"
  if (host === "a.klaviyo.com") return "klaviyo"
  if (host === "graph.facebook.com") return "meta"
  if (host.includes("gorgias.com")) return "gorgias"
  if (host === "api.pinterest.com") return "pinterest"
  return host
}

// ---------------------------------------------------------------------------
// Per-integration auth injection strategy
// ---------------------------------------------------------------------------

export type AuthMethod =
  | { type: "bearer" }
  | { type: "header"; name: string }
  | { type: "basic"; extraKey: string }
  | { type: "query"; param: string }

/**
 * How each integration's credential should be injected into outgoing requests.
 * - bearer:  Authorization: Bearer {token}
 * - header:  {name}: {token}  (custom header)
 * - basic:   Authorization: Basic base64({extras[extraKey]}:{token})
 * - query:   append/replace ?{param}={token} on the request URL
 */
export const INTEGRATION_AUTH: Record<string, AuthMethod> = {
  notion:     { type: "bearer" },
  github:     { type: "bearer" },
  slack:      { type: "bearer" },
  google:     { type: "bearer" },
  air:        { type: "bearer" },
  quickbooks: { type: "bearer" },
  pinterest:  { type: "bearer" },
  shopify:    { type: "header", name: "X-Shopify-Access-Token" },
  klaviyo:    { type: "header", name: "Klaviyo-API-Key" },
  gorgias:    { type: "basic", extraKey: "email" },
  meta:       { type: "query", param: "access_token" },
  instagram:  { type: "query", param: "access_token" },
  gemini:     { type: "query", param: "key" },
}

export interface ResolvedCredential {
  token: string
  /** Additional context needed for auth injection (e.g., email for Basic auth). */
  extras?: Record<string, string>
}

export interface CredentialProxyOptions {
  /**
   * Given a session token (extracted from the Proxy-Authorization header, which
   * HTTP clients set automatically from the userinfo in the proxy URL) and an
   * integration name, resolve the credential from the vault. Return null if not
   * found.
   */
  resolveCredential: (sessionToken: string, integration: string) => Promise<ResolvedCredential | null>
}

/**
 * Format a credential into the appropriate HTTP header line for an integration.
 */
function formatAuthHeader(method: AuthMethod, cred: ResolvedCredential): string {
  switch (method.type) {
    case "bearer":
      return `Authorization: Bearer ${cred.token}`
    case "header":
      return `${method.name}: ${cred.token}`
    case "basic": {
      const user = cred.extras?.[method.extraKey] ?? ""
      const encoded = Buffer.from(`${user}:${cred.token}`).toString("base64")
      return `Authorization: Basic ${encoded}`
    }
    case "query":
      // Query params are injected into the URL, not as a header
      return ""
  }
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

    if (!shouldIntercept(host)) {
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

    // MITM intercept — terminate TLS with a cert for this host
    const hostCert = await generateCertForHost(host, ca)
    const integration = hostToIntegration(host)

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

          const authMethod = INTEGRATION_AUTH[integration]
          let finalRequestLine = requestLine

          // For query-param auth, inject/replace the param in the URL
          if (cred && authMethod?.type === "query") {
            const match = requestLine.match(/^(\S+)\s+(\S+)\s+(\S+)$/)
            if (match) {
              const [, method, rawUrl, httpVersion] = match
              const url = new URL(rawUrl, `https://${host}`)
              url.searchParams.set(authMethod.param, cred.token)
              finalRequestLine = `${method} ${url.pathname}${url.search} ${httpVersion}`
            }
          }

          // Rebuild headers with credential injection
          const newHeaders: string[] = [finalRequestLine]
          const authHeaderName = authMethod?.type === "header" ? authMethod.name.toLowerCase() : "authorization"
          let injected = false

          for (let i = 1; i < lines.length; i++) {
            const lowerLine = lines[i]!.toLowerCase()
            if (cred && lowerLine.startsWith(`${authHeaderName}:`)) {
              // Replace existing header with the real credential
              newHeaders.push(formatAuthHeader(authMethod!, cred))
              injected = true
            } else {
              newHeaders.push(lines[i]!)
            }
          }

          // Add header if it wasn't already present (bearer/header/basic only)
          if (cred && !injected && authMethod?.type !== "query") {
            newHeaders.push(formatAuthHeader(authMethod!, cred))
          }

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
