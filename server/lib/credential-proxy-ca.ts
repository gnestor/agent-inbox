// @ts-ignore — selfsigned types may not match runtime API
import selfsigned from "selfsigned"
import { writeFileSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { rootCertificates } from "node:tls"

interface CertKeyPair {
  cert: string
  key: string
}

let cachedCA: CertKeyPair | null = null
const hostCertCache = new Map<string, CertKeyPair>()

/** Maximum number of host certificates to keep cached. Oldest entries evicted first. */
const MAX_HOST_CERTS = 100

/** Move a key to the most-recently-used position; evict oldest if over capacity. */
function touchLru(key: string, value: CertKeyPair): void {
  hostCertCache.delete(key)
  hostCertCache.set(key, value)
  while (hostCertCache.size > MAX_HOST_CERTS) {
    const oldest = hostCertCache.keys().next().value
    if (oldest === undefined) break
    hostCertCache.delete(oldest)
  }
}

/**
 * Generate a self-signed CA certificate for the credential proxy.
 * The CA is used to sign per-host certificates so the agent subprocess
 * trusts the MITM proxy via NODE_EXTRA_CA_CERTS.
 */
export async function generateCA(): Promise<CertKeyPair> {
  if (cachedCA) return cachedCA

  const attrs = [{ name: "commonName", value: "Inbox Credential Proxy CA" }]
  const pems = await selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    extensions: [
      { name: "basicConstraints", cA: true, critical: true },
      {
        name: "keyUsage",
        keyCertSign: true,
        cRLSign: true,
        critical: true,
      },
    ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- selfsigned types don't include the extensions/cA options that the runtime API supports
  } as any)

  cachedCA = { cert: pems.cert, key: pems.private }
  return cachedCA
}

/**
 * Generate a TLS certificate for a specific host, signed by our CA.
 * Certificates are cached per-host for the lifetime of the process.
 */
export async function generateCertForHost(
  host: string,
  ca: CertKeyPair
): Promise<CertKeyPair> {
  const cached = hostCertCache.get(host)
  if (cached) {
    // Promote to most-recently-used
    touchLru(host, cached)
    return cached
  }

  const attrs = [{ name: "commonName", value: host }]
  const pems = await selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    extensions: [
      {
        name: "subjectAltName",
        altNames: [{ type: 2, value: host }], // DNS name
      },
    ],
    // Sign with our CA
    ca: { key: ca.key, cert: ca.cert },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- selfsigned types don't include the ca signing option that the runtime API supports
  } as any)

  const pair = { cert: pems.cert, key: pems.private }
  touchLru(host, pair)
  return pair
}

/** Current size of the host cert cache — for tests. */
export function _getHostCertCacheSize(): number {
  return hostCertCache.size
}

/** Test-only: inspect cache keys in insertion order (oldest first). */
export function _getHostCertCacheKeys(): string[] {
  return Array.from(hostCertCache.keys())
}

/** Max cache size constant exposed for tests. */
export const _MAX_HOST_CERTS = MAX_HOST_CERTS

/**
 * Write the CA bundle to a temp file and return the path.
 * Used for NODE_EXTRA_CA_CERTS in agent subprocesses.
 *
 * The bundle MUST contain the public root certificates in addition to our
 * proxy CA. The agent SDK reads NODE_EXTRA_CA_CERTS and passes it as the
 * *exclusive* `ca` for its undici dispatcher's TLS — this replaces (not
 * augments) the default root store. Without the public roots, direct TLS to
 * non-intercepted hosts (api.anthropic.com via NO_PROXY) fails certificate
 * verification, surfacing as UND_ERR_INVALID_ARG / UNABLE_TO_GET_ISSUER_CERT.
 */
export async function writeCACertFile(): Promise<string> {
  const ca = await generateCA()
  const dir = mkdtempSync(join(tmpdir(), "inbox-proxy-ca-"))
  const certPath = join(dir, "ca.pem")
  const bundle = [ca.cert, ...rootCertificates].join("\n")
  writeFileSync(certPath, bundle)
  return certPath
}

/** Reset caches — for testing only */
export function _resetCaches() {
  cachedCA = null
  hostCertCache.clear()
}
