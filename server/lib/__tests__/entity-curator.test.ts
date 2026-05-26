import { describe, expect, test } from "vitest"
import { candidatePageSlugs } from "../entity-curator.js"

describe("candidatePageSlugs", () => {
  test("domain: returns both dotted-form and brand-form (TLD-stripped)", () => {
    expect(candidatePageSlugs("domain", "gusto.com")).toEqual(["gusto-com", "gusto"])
    expect(candidatePageSlugs("domain", "mhomovement.com")).toEqual(["mhomovement-com", "mhomovement"])
    expect(candidatePageSlugs("domain", "the-sourcing-company.net")).toEqual([
      "the-sourcing-company-net",
      "the-sourcing-company",
    ])
  })

  test("domain: handles double-TLD (.com.au, .co.uk)", () => {
    // Brand slug strips both segments — `intas-com-au` -> `intas`
    const slugs = candidatePageSlugs("domain", "intas.com.au")
    expect(slugs[0]).toBe("intas-com-au")
    expect(slugs).toContain("intas")
  })

  test("domain: brand slug omitted when identical to dotted slug", () => {
    // Single-segment hypothetical: same string both ways → only one entry
    expect(candidatePageSlugs("domain", "shopify")).toEqual(["shopify"])
  })

  test("person with email: only one slug, no domain fallback", () => {
    // Person pages must NOT short-circuit to a domain page via the candidate
    // lookup — that path is handled by findParentCompanyPage with explicit
    // company-merge prompt steering.
    expect(candidatePageSlugs("person", "kurt@incip.com")).toEqual(["kurt-incip-com"])
  })

  test("company / project: single slug", () => {
    expect(candidatePageSlugs("company", "The Sourcing Company")).toEqual(["the-sourcing-company"])
    expect(candidatePageSlugs("project", "Nordstrom Marketplace")).toEqual(["nordstrom-marketplace"])
  })

  test("folder: single slug", () => {
    expect(candidatePageSlugs("folder", "Pacifica 2019")).toEqual(["pacifica-2019"])
  })
})
