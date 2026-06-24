import { describe, it, expect } from "vitest"
import { isTransientQuery } from "../query-persistence"

describe("isTransientQuery", () => {
  it("never persists error or pending queries", () => {
    expect(isTransientQuery("error", ["plugins"], undefined)).toBe(true)
    expect(isTransientQuery("pending", ["plugins"], undefined)).toBe(true)
  })

  it("never persists sessions / session / connections (stale-on-reload keys)", () => {
    expect(isTransientQuery("success", ["sessions"], [])).toBe(true)
    expect(isTransientQuery("success", ["session", "abc"], {})).toBe(true)
    expect(isTransientQuery("success", ["connections"], {})).toBe(true)
  })

  it("persists the plugin list infinite query so it restores instantly on reload", () => {
    // The plugin list loads the full set in one page; persisting it is the whole
    // point (matches Studio's cached lists). Despite the {pages} shape, it is NOT
    // transient.
    const infiniteData = { pages: [{ items: [{ id: "t1" }], nextCursor: undefined }], pageParams: [undefined] }
    expect(isTransientQuery("success", ["plugin-items-infinite", "ws1", "gmail", {}], infiniteData)).toBe(false)
  })

  it("still excludes other infinite-query shapes from persistence", () => {
    const infiniteData = { pages: [{ items: [] }], pageParams: [undefined] }
    expect(isTransientQuery("success", ["some-other-infinite"], infiniteData)).toBe(true)
  })

  it("persists ordinary successful list/detail queries", () => {
    expect(isTransientQuery("success", ["plugins"], [{ id: "gmail" }])).toBe(false)
    expect(isTransientQuery("success", ["plugin-item", "ws1", "gmail", "t1"], { id: "t1" })).toBe(false)
  })
})
