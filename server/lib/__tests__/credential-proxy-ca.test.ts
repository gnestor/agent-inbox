import { describe, it, expect, beforeEach, vi } from "vitest"
import { X509Certificate } from "node:crypto"
import { readFileSync } from "node:fs"
import {
  generateCA,
  generateCertForHost,
  writeCACertFile,
  _resetCaches,
  _getHostCertCacheSize,
  _getHostCertCacheKeys,
  _MAX_HOST_CERTS,
} from "../credential-proxy-ca.js"

describe("credential-proxy-ca", () => {
  beforeEach(() => {
    _resetCaches()
  })

  let ca: { cert: string; key: string }

  it("generates a CA certificate and key", async () => {
    ca = await generateCA()
    expect(ca.cert).toContain("-----BEGIN CERTIFICATE-----")
    expect(ca.key).toContain("-----BEGIN")
  })

  it("Scenario: CA is generated once per process and cached in memory — repeat calls return the same cached pair", async () => {
    const first = await generateCA()
    const second = await generateCA()
    expect(second.cert).toBe(first.cert)
    expect(second.key).toBe(first.key)
  })

  it("generates a host certificate signed by the CA", async () => {
    ca = await generateCA()
    const hostCert = await generateCertForHost("api.notion.com", ca)
    expect(hostCert.cert).toContain("-----BEGIN CERTIFICATE-----")
    expect(hostCert.key).toContain("-----BEGIN")
    // Host cert should be different from CA cert
    expect(hostCert.cert).not.toBe(ca.cert)
  })

  it("Scenario: Per-host cert is generated on demand and LRU-cached — caches host certificates for the same host", async () => {
    ca = await generateCA()
    const cert1 = await generateCertForHost("api.notion.com", ca)
    const cert2 = await generateCertForHost("api.notion.com", ca)
    expect(cert1.cert).toBe(cert2.cert)
  })

  it("Scenario: Per-host certs include SAN for the host — cert has commonName and subjectAltName DNS for the host", async () => {
    ca = await generateCA()
    const hostCert = await generateCertForHost("api.notion.com", ca)
    const x509 = new X509Certificate(hostCert.cert)
    expect(x509.subject).toContain("api.notion.com")
    expect(x509.subjectAltName).toContain("DNS:api.notion.com")
  })

  it("Scenario: CA cert is written to a temp file for `NODE_EXTRA_CA_CERTS` — writes ca.pem and returns its path", async () => {
    const path = await writeCACertFile()
    expect(path).toMatch(/ca\.pem$/)
    expect(path).toContain("inbox-proxy-ca-")
    expect(readFileSync(path, "utf8")).toContain("-----BEGIN CERTIFICATE-----")
  })

  it("generates different certificates for different hosts", async () => {
    ca = await generateCA()
    const cert1 = await generateCertForHost("api.notion.com", ca)
    const cert2 = await generateCertForHost("api.github.com", ca)
    expect(cert1.cert).not.toBe(cert2.cert)
  })

  it("tracks cache size as hosts are added", async () => {
    ca = await generateCA()
    expect(_getHostCertCacheSize()).toBe(0)
    await generateCertForHost("host1.example.com", ca)
    expect(_getHostCertCacheSize()).toBe(1)
    await generateCertForHost("host2.example.com", ca)
    expect(_getHostCertCacheSize()).toBe(2)
    // Cached hit doesn't grow the cache
    await generateCertForHost("host1.example.com", ca)
    expect(_getHostCertCacheSize()).toBe(2)
  })

  it("promotes cached entry to most-recently-used on hit", async () => {
    ca = await generateCA()
    await generateCertForHost("host-a.example.com", ca)
    await generateCertForHost("host-b.example.com", ca)
    await generateCertForHost("host-c.example.com", ca)
    expect(_getHostCertCacheKeys()).toEqual([
      "host-a.example.com",
      "host-b.example.com",
      "host-c.example.com",
    ])
    // Touch host-a — should move to end (most recent)
    await generateCertForHost("host-a.example.com", ca)
    expect(_getHostCertCacheKeys()).toEqual([
      "host-b.example.com",
      "host-c.example.com",
      "host-a.example.com",
    ])
  })

  it("evicts oldest entries when cache exceeds MAX_HOST_CERTS", async () => {
    // Use a real CA for signing but mock selfsigned.generate to be fast
    // after the CA is generated
    const realSelfsigned = await import("selfsigned")
    const realGenerate = realSelfsigned.default.generate.bind(realSelfsigned.default)

    let callCount = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spy = vi.spyOn(realSelfsigned.default, "generate").mockImplementation(
      (async (attrs: any, opts: any) => {
        callCount++
        // Let the first call (CA generation) go through for real,
        // then use fast stubs for host certs
        if (callCount === 1) {
          return realGenerate(attrs, opts)
        }
        return {
          cert: `CERT-${attrs?.[0]?.value}`,
          private: `KEY-${attrs?.[0]?.value}`,
        }
      }) as any,
    )

    try {
      ca = await generateCA()

      const totalHosts = _MAX_HOST_CERTS + 5 // 105
      for (let i = 0; i < totalHosts; i++) {
        await generateCertForHost(`host-${i}.example.com`, ca)
        // Cache size should never exceed MAX_HOST_CERTS
        expect(_getHostCertCacheSize()).toBeLessThanOrEqual(_MAX_HOST_CERTS)
      }

      // Final cache size should be exactly MAX_HOST_CERTS
      expect(_getHostCertCacheSize()).toBe(_MAX_HOST_CERTS)

      // The first 5 hosts should have been evicted
      const keys = _getHostCertCacheKeys()
      for (let i = 0; i < 5; i++) {
        expect(keys).not.toContain(`host-${i}.example.com`)
      }

      // The last MAX_HOST_CERTS hosts should still be present
      for (let i = 5; i < totalHosts; i++) {
        expect(keys).toContain(`host-${i}.example.com`)
      }
    } finally {
      spy.mockRestore()
    }
  })
})
