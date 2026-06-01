import { describe, it, expect } from "vitest"
import { gateEntity } from "../entity-gate.js"

describe("gateEntity", () => {
  describe("opaque IDs", () => {
    it("Scenario: Opaque IDs are rejected without a Claude call — skips Account # patterns", () => {
      const r = gateEntity("project", "Account #5015911")
      expect(r.skip).toBe(true)
    })

    it("skips long opaque IDs (Drive file IDs)", () => {
      const r = gateEntity("folder", "1aBcDeFgHiJkLmNoPqRsTuVwXyZ123")
      expect(r.skip).toBe(true)
    })

    it("does NOT skip short business slugs", () => {
      const r = gateEntity("company", "wuxi-hende")
      expect(r.skip).toBe(false)
    })

    it("skips UUIDs", () => {
      const r = gateEntity("session", "01234567-89ab-cdef-0123-456789abcdef")
      expect(r.skip).toBe(true)
    })

    it("skips pure-numeric IDs", () => {
      const r = gateEntity("folder", "1234567")
      expect(r.skip).toBe(true)
    })

    it("skips ticket-number style", () => {
      const r = gateEntity("project", "#12345")
      expect(r.skip).toBe(true)
    })

    it("skips raw URLs", () => {
      const r = gateEntity("project", "https://example.com/foo")
      expect(r.skip).toBe(true)
    })

    it("does NOT skip ordinary names", () => {
      const r = gateEntity("person", "Caroline Tuerk")
      expect(r.skip).toBe(false)
    })

    it("does NOT skip ordinary slugs", () => {
      const r = gateEntity("company", "wuxi-hende")
      expect(r.skip).toBe(false)
    })
  })

  describe("personal email domains", () => {
    it("Scenario: Personal email-provider domains are rejected — skips gmail.com domain entity", () => {
      const r = gateEntity("domain", "gmail.com")
      expect(r.skip).toBe(true)
    })

    it("skips yahoo.com domain entity", () => {
      const r = gateEntity("domain", "yahoo.com")
      expect(r.skip).toBe(true)
    })

    it("skips privaterelay.appleid.com (Apple iCloud relay)", () => {
      const r = gateEntity("domain", "privaterelay.appleid.com")
      expect(r.skip).toBe(true)
    })

    it("does NOT skip person:<gmail address>", () => {
      // The person, not the domain, may still be a valid entity
      const r = gateEntity("person", "ron@gmail.com")
      expect(r.skip).toBe(false)
    })

    it("does NOT skip business domains", () => {
      const r = gateEntity("domain", "distributionmgmt.com")
      expect(r.skip).toBe(false)
    })

    it("is case-insensitive on domain", () => {
      const r = gateEntity("domain", "GMAIL.COM")
      expect(r.skip).toBe(true)
    })
  })

  describe("self domains", () => {
    it("Scenario: Self-references are rejected — skips hammies.com domain", () => {
      const r = gateEntity("domain", "hammies.com")
      expect(r.skip).toBe(true)
    })

    it("skips hammiesshorts.com domain", () => {
      const r = gateEntity("domain", "hammiesshorts.com")
      expect(r.skip).toBe(true)
    })
  })

  describe("tag noise", () => {
    it("skips CATEGORY_ prefixed gmail labels", () => {
      const r = gateEntity("tag", "CATEGORY_PROMOTIONS")
      expect(r.skip).toBe(true)
    })

    it("skips smartlead/ prefixed tags", () => {
      const r = gateEntity("tag", "smartlead/sequence-1")
      expect(r.skip).toBe(true)
    })

    it("does NOT skip business tags", () => {
      const r = gateEntity("tag", "wholesale")
      expect(r.skip).toBe(false)
    })
  })

  describe("trivial values", () => {
    it("skips empty values", () => {
      const r = gateEntity("person", "")
      expect(r.skip).toBe(true)
    })

    it("skips whitespace-only values", () => {
      const r = gateEntity("person", "   ")
      expect(r.skip).toBe(true)
    })

    it("skips single-character values", () => {
      const r = gateEntity("person", "a")
      expect(r.skip).toBe(true)
    })
  })
})
