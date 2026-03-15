import { createServer, type Server, type IncomingMessage } from "node:http"
import { connect as tlsConnect, createServer as createTlsServer } from "node:tls"
import { Socket } from "node:net"
import { generateCA, generateCertForHost, writeCACertFile } from "./credential-proxy-ca.js"

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
  "shopify.com",       // *.shopify.com via endsWith check
  "googleapis.com",    // *.googleapis.com via endsWith check
  "api.air.inc",
]

export function shouldIntercept(host: string): boolean {
  return INTERCEPTED_HOSTS.some(
    (h) => host === h || host.endsWith(`.${h}`)
  )
}

/**
 * Map intercepted host to the integration name used in the vault.
 */
export function hostToIntegration(host: string): string {
  if (host === "api.notion.com") return "notion"
  if (host === "api.github.com") return "github"
  if (host.includes("slack.com")) return "slack"
  if (host.includes("shopify.com")) return "shopify"
  if (host.includes("googleapis.com")) return "google"
  if (host === "api.air.inc") return "air"
  return host
}

export interface CredentialProxyOptions {
  /**
   * Given a session token (extracted from the Proxy-Authorization header, which
   * HTTP clients set automatically from the userinfo in the proxy URL) and an
   * integration name, resolve the Bearer/API token from the vault. Return null
   * if not found.
   */
  resolveToken: (sessionToken: string, integration: string) => Promise<string | null>
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
    const [host, portStr] = (req.url || "").split(":")
    const port = parseInt(portStr || "443", 10)

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
        tlsSocket.on("data", async (chunk) => {
          rawData += chunk.toString()

          // Wait for headers to be complete
          if (!rawData.includes("\r\n\r\n")) return
          tlsSocket.pause()

          // Parse HTTP request
          const headerEnd = rawData.indexOf("\r\n\r\n")
          const headerSection = rawData.slice(0, headerEnd)
          const body = rawData.slice(headerEnd + 4)
          const lines = headerSection.split("\r\n")
          const requestLine = lines[0]

          // Resolve token from vault
          let authHeader: string | null = null
          if (sessionToken) {
            const token = await options.resolveToken(sessionToken, integration)
            if (token) {
              authHeader = `Bearer ${token}`
            }
          }

          // Rebuild headers, injecting/replacing Authorization
          const newHeaders: string[] = [requestLine]
          let hasAuth = false
          for (let i = 1; i < lines.length; i++) {
            if (lines[i].toLowerCase().startsWith("authorization:") && authHeader) {
              newHeaders.push(`Authorization: ${authHeader}`)
              hasAuth = true
            } else {
              newHeaders.push(lines[i])
            }
          }
          if (!hasAuth && authHeader) {
            newHeaders.push(`Authorization: ${authHeader}`)
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
          NODE_USE_ENV_PROXY: "1",
        }),
      }

      console.log(`Credential proxy listening on 127.0.0.1:${addr.port}`)
      resolve(proxy)
    })

    server.on("error", reject)
  })
}
