import { describe, it, expect, beforeEach } from "vitest"
import {
  generateCA,
  generateCertForHost,
  _resetCaches,
  _getHostCertCacheSize,
  _getHostCertCacheKeys,
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

  it("generates a host certificate signed by the CA", async () => {
    ca = await generateCA()
    const hostCert = await generateCertForHost("api.notion.com", ca)
    expect(hostCert.cert).toContain("-----BEGIN CERTIFICATE-----")
    expect(hostCert.key).toContain("-----BEGIN")
    // Host cert should be different from CA cert
    expect(hostCert.cert).not.toBe(ca.cert)
  })

  it("caches host certificates for the same host", async () => {
    ca = await generateCA()
    const cert1 = await generateCertForHost("api.notion.com", ca)
    const cert2 = await generateCertForHost("api.notion.com", ca)
    expect(cert1.cert).toBe(cert2.cert)
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
})
