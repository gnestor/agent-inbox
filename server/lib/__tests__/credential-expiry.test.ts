import { describe, it, expect } from "vitest"
import { isCredentialExpired } from "../credential-expiry.js"

describe("isCredentialExpired", () => {
  const now = 1_000_000_000_000

  it("Scenario: A credential past its expiry is refreshed", () => {
    expect(isCredentialExpired(new Date(now - 1_000).toISOString(), 60_000, now)).toBe(true)
  })

  it("Scenario: A credential within the skew window is refreshed", () => {
    // 30s out, but the 60s skew means we refresh early.
    expect(isCredentialExpired(new Date(now + 30_000).toISOString(), 60_000, now)).toBe(true)
  })

  it("Scenario: A comfortably valid credential is not refreshed", () => {
    expect(isCredentialExpired(new Date(now + 600_000).toISOString(), 60_000, now)).toBe(false)
  })

  it("Scenario: A credential with no expiry is not treated as expired", () => {
    expect(isCredentialExpired(null, 60_000, now)).toBe(false)
    expect(isCredentialExpired(undefined, 60_000, now)).toBe(false)
  })

  // Boundary: exactly at (now + skew) is considered expired (<=).
  it("treats the exact skew boundary as expired", () => {
    expect(isCredentialExpired(new Date(now + 60_000).toISOString(), 60_000, now)).toBe(true)
  })
})
