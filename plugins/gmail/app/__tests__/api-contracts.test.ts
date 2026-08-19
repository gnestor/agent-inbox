import { afterEach, describe, expect, it, vi } from "vitest"
import { getEmailThread, searchEmails } from "../api"

function apiResponse(data: unknown): Response {
  return new Response(JSON.stringify({ contractVersion: 1, data }), {
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Gmail browser API contracts", () => {
  it("Scenario: malformed Gmail search items are rejected at the HTTP boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(apiResponse({
      messages: [{ id: "thread-1" }],
      nextPageToken: null,
    })))

    await expect(searchEmails("in:inbox")).rejects.toThrow()
  })

  it("Scenario: malformed Gmail threads are rejected at the HTTP boundary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(apiResponse({
      id: "thread-1",
      messages: "not-an-array",
    })))

    await expect(getEmailThread("thread-1")).rejects.toThrow()
  })
})
