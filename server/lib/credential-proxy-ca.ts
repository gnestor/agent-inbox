// @ts-expect-error — selfsigned has no type declarations
import selfsigned from "selfsigned"
import { writeFileSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

interface CertKeyPair {
  cert: string
  key: string
}

let cachedCA: CertKeyPair | null = null
const hostCertCache = new Map<string, CertKeyPair>()

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
  })

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
  if (cached) return cached

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
  })

  const pair = { cert: pems.cert, key: pems.private }
  hostCertCache.set(host, pair)
  return pair
}

/**
 * Write the CA cert to a temp file and return the path.
 * Used for NODE_EXTRA_CA_CERTS in agent subprocesses.
 */
export async function writeCACertFile(): Promise<string> {
  const ca = await generateCA()
  const dir = mkdtempSync(join(tmpdir(), "inbox-proxy-ca-"))
  const certPath = join(dir, "ca.pem")
  writeFileSync(certPath, ca.cert)
  return certPath
}

/** Reset caches — for testing only */
export function _resetCaches() {
  cachedCA = null
  hostCertCache.clear()
}
