import { describe, it, expect } from "vitest"
import { parseModelOutput } from "../body-extractor.js"

describe("body-extractor parseModelOutput", () => {
  it("Scenario: Stage 3 — body extraction via Ollama with noise filter — keeps real entities, drops promo/automated/ubiquitous noise", () => {
    const raw = JSON.stringify({
      entities: [
        { type: "person", value: "Caroline Tuerk" },
        { type: "company", value: "Wuxi Hende" },
        // noise: ubiquitous platform name
        { type: "company", value: "Shopify" },
        // noise: automated local part
        { type: "person", value: "noreply@news.acme.com" },
        // noise: promo subdomain on a domain entity
        { type: "domain", value: "news.acme.com" },
        // noise: generic person
        { type: "person", value: "the team" },
      ],
    })
    const out = parseModelOutput(raw)
    const values = out.map((e) => e.value)
    expect(values).toContain("caroline tuerk")
    expect(values).toContain("wuxi-hende")
    // All noise entries filtered before insert.
    expect(values).not.toContain("shopify")
    expect(out.some((e) => e.type === "domain" && e.value.includes("news"))).toBe(false)
    expect(values.some((v) => v.includes("noreply"))).toBe(false)
  })

  it("returns [] for null or non-JSON output", () => {
    expect(parseModelOutput(null)).toEqual([])
    expect(parseModelOutput("not json")).toEqual([])
  })
})
