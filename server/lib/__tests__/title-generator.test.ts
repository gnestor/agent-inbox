import { describe, it, expect, vi, afterEach } from "vitest"
import { buildTitlePrompt, parseTitleResponse, generateSessionTitle } from "../title-generator.js"

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

    it("Scenario: Skips messages without text content — tool-only turns are dropped before windowing", () => {
      const messages = [
        { type: "user", message: JSON.stringify({ type: "user", content: "Real prompt" }) },
        // tool-result style turn: no string content, no text blocks
        { type: "user", message: JSON.stringify({ type: "user", content: [{ type: "tool_result", tool_use_id: "t1" }] }) },
        { type: "assistant", message: JSON.stringify({ type: "assistant", content: [{ type: "tool_use", name: "Bash" }] }) },
      ]
      const result = buildTitlePrompt(messages as any)
      expect(result).toContain("Real prompt")
      // The tool-only turns contribute no text — only the one user line survives
      expect(result.split("\n\n").filter((l) => l.trim()).length).toBe(1)
    })

    it("Scenario: Window is first 3 user + last assistant — caps users, keeps last assistant, truncates to 500 chars", () => {
      const messages = [
        ...Array.from({ length: 5 }, (_, i) => ({
          type: "user",
          message: JSON.stringify({ type: "user", content: `U${i} ` + "x".repeat(800) }),
        })),
        { type: "assistant", message: JSON.stringify({ type: "assistant", content: "First assistant" }) },
        { type: "assistant", message: JSON.stringify({ type: "assistant", content: "Last assistant reply" }) },
      ]
      const result = buildTitlePrompt(messages as any)
      const userLines = result.split("\n\n").filter((l) => l.startsWith("User:"))
      expect(userLines).toHaveLength(3)
      expect(result).toContain("Last assistant reply")
      expect(result).not.toContain("First assistant")
      // each user content truncated to 500 chars
      for (const line of userLines) expect(line.replace(/^User: /, "").length).toBeLessThanOrEqual(500)
    })

    it("Scenario: Empty transcript yields empty string — no parseable message survives", () => {
      const messages = [
        { type: "system", message: JSON.stringify({ type: "system", content: "init" }) },
        { type: "user", message: "not-json{" },
      ]
      expect(buildTitlePrompt(messages as any)).toBe("")
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

    it("Scenario: Strips wrapping quotes — removes surrounding double or single quotes", () => {
      expect(parseTitleResponse('"Draft Q1 email"')).toBe("Draft Q1 email")
      expect(parseTitleResponse("'Debug auth'")).toBe("Debug auth")
    })

    it("Scenario: Strips `Title:` prefix — case-insensitive prefix removal", () => {
      expect(parseTitleResponse("Title: Draft Q1 email")).toBe("Draft Q1 email")
      expect(parseTitleResponse("title: Debug auth")).toBe("Debug auth")
    })

    it("Scenario: Truncates over-length titles with ellipsis — 57 chars + `...`", () => {
      const long = "A".repeat(80)
      const out = parseTitleResponse(long)!
      expect(out.length).toBe(60)
      expect(out.endsWith("...")).toBe(true)
      expect(out.slice(0, 57)).toBe("A".repeat(57))
    })

    it("Scenario: Empty response yields null — trimmed-empty returns null", () => {
      expect(parseTitleResponse("")).toBeNull()
      expect(parseTitleResponse("   ")).toBeNull()
    })
  })

  describe("generateSessionTitle", () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it("Scenario: Generation failure is swallowed — logs to console.error and returns null", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      // Force the Anthropic client to throw (network error / missing key / 429).
      vi.doMock("@anthropic-ai/sdk", () => ({
        default: class {
          messages = { create: async () => { throw new Error("boom") } }
        },
      }))
      vi.resetModules()
      const { generateSessionTitle: gen } = await import("../title-generator.js")
      const messages = [
        { type: "user", message: JSON.stringify({ type: "user", content: "Do a thing" }) },
      ]
      const result = await gen(messages as any)
      expect(result).toBeNull()
      expect(errSpy).toHaveBeenCalled()
      vi.doUnmock("@anthropic-ai/sdk")
    })

    it("returns null without calling the API when transcript is empty", async () => {
      const result = await generateSessionTitle([])
      expect(result).toBeNull()
    })
  })
})
