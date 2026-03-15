import { describe, it, expect, vi } from "vitest"
import { buildTitlePrompt, parseTitleResponse } from "../title-generator.js"

describe("title-generator", () => {
  describe("buildTitlePrompt", () => {
    it("includes user prompt and assistant summary", () => {
      const messages = [
        { type: "user", message: JSON.stringify({ type: "user", content: "Draft an email to Kevin about Q1 results" }) },
        { type: "assistant", message: JSON.stringify({ type: "assistant", content: "I've drafted the email..." }) },
      ]
      const result = buildTitlePrompt(messages as any)
      expect(result).toContain("Q1 results")
    })

    it("truncates long transcripts to fit context", () => {
      const messages = Array.from({ length: 100 }, (_, i) => ({
        type: "user",
        message: JSON.stringify({ type: "user", content: `Message ${i} with lots of content `.repeat(50) }),
      }))
      const result = buildTitlePrompt(messages as any)
      expect(result.length).toBeLessThan(6000)
    })
  })

  describe("parseTitleResponse", () => {
    it("extracts clean title from response", () => {
      expect(parseTitleResponse("Draft Q1 results email to Kevin")).toBe("Draft Q1 results email to Kevin")
    })

    it("strips surrounding quotes", () => {
      expect(parseTitleResponse('"Draft Q1 email"')).toBe("Draft Q1 email")
    })

    it("truncates to 60 chars", () => {
      const long = "A".repeat(80)
      expect(parseTitleResponse(long).length).toBeLessThanOrEqual(60)
    })

    it("returns null for empty response", () => {
      expect(parseTitleResponse("")).toBeNull()
    })
  })
})
