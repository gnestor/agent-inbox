import { describe, it, expect } from "vitest"
import * as instructionsModule from "../session-instructions.js"
import { SESSION_INSTRUCTIONS } from "../session-instructions.js"

describe("session-instructions", () => {
  describe("module shape", () => {
    it("Scenario: Single named export `SESSION_INSTRUCTIONS` — the string is the entire module contract", () => {
      expect(Object.keys(instructionsModule)).toEqual(["SESSION_INSTRUCTIONS"])
      expect(typeof SESSION_INSTRUCTIONS).toBe("string")
      expect(SESSION_INSTRUCTIONS.length).toBeGreaterThan(0)
    })

    it("Scenario: Consumed only by `session-manager` via `appendSystemPrompt` — composes cleanly with optional source context", () => {
      // Mirror session-manager's composition: [SESSION_INSTRUCTIONS, context].filter(Boolean).join("\n\n")
      const withContext = [SESSION_INSTRUCTIONS, "EMAIL THREAD"].filter(Boolean).join("\n\n")
      expect(withContext).toBe(`${SESSION_INSTRUCTIONS}\n\nEMAIL THREAD`)
      const noContext = [SESSION_INSTRUCTIONS, ""].filter(Boolean).join("\n\n")
      expect(noContext).toBe(SESSION_INSTRUCTIONS)
    })
  })

  describe("instruction content", () => {
    it("Scenario: Authentication delegated to the credential proxy — tells the agent credentials are injected, no tokens needed", () => {
      expect(SESSION_INSTRUCTIONS).toMatch(/credential proxy/i)
      expect(SESSION_INSTRUCTIONS).toMatch(/do not need API keys/i)
    })

    it("Scenario: Source-context handling rule — instructs fetching full source before responding", () => {
      expect(SESSION_INSTRUCTIONS).toMatch(/Read source data first/i)
      expect(SESSION_INSTRUCTIONS).toMatch(/summary; always read the complete data/i)
    })

    it("Scenario: External artifacts must include a direct URL — instructs including the resource URL in output", () => {
      expect(SESSION_INSTRUCTIONS).toMatch(/include a direct URL/i)
      expect(SESSION_INSTRUCTIONS).toMatch(/external resources/i)
    })

    it("Scenario: One artifact per `render_output` — never combine multiple outputs into one markdown block", () => {
      expect(SESSION_INSTRUCTIONS).toMatch(/separate `render_output` call/i)
      expect(SESSION_INSTRUCTIONS).toMatch(/Never combine multiple outputs/i)
    })

    it("Scenario: Updates use the same `title` — re-render with same title replaces, never leave superseded outputs", () => {
      expect(SESSION_INSTRUCTIONS).toMatch(/same `title`/i)
      expect(SESSION_INSTRUCTIONS).toMatch(/Never leave broken or superseded outputs/i)
    })

    it("Scenario: `render_output` type selection guidance — enumerates table/json/markdown/html/chart/react with the react code clause", () => {
      for (const t of ["table", "json", "markdown", "html", "chart", "react"]) {
        expect(SESSION_INSTRUCTIONS).toContain(`\`${t}\``)
      }
      expect(SESSION_INSTRUCTIONS).toMatch(/`data` field must be `\{ code: "<JSX string>" \}`/)
      expect(SESSION_INSTRUCTIONS).toMatch(/never pass raw data objects/i)
    })

    it("Scenario: User input flows through `AskUserQuestion` — covers actions, plans, clarification, never plain text", () => {
      expect(SESSION_INSTRUCTIONS).toMatch(/Use `AskUserQuestion` for all user input/i)
      expect(SESSION_INSTRUCTIONS).toMatch(/Never ask questions via plain text/i)
      expect(SESSION_INSTRUCTIONS).toMatch(/proposing actions, confirming plans, requesting clarification/i)
    })
  })
})
