import { describe, it, expect, beforeEach } from "vitest"
import { generateCA, generateCertForHost, _resetCaches } from "../credential-proxy-ca.js"

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
})
