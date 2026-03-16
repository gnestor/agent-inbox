import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../email-sanitizer.js", () => ({
  sanitizeHtmlEmail: (html: string) => html,
  sanitizePlainText: (text: string) => text,
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

function okJson(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) })
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg1",
    threadId: "t1",
    labelIds: ["INBOX"],
    snippet: "Hello world",
    payload: {
      headers: [
        { name: "From", value: "alice@example.com" },
        { name: "To", value: "bob@example.com" },
        { name: "Subject", value: "Test subject" },
        { name: "Date", value: "Mon, 1 Jan 2025 12:00:00 +0000" },
      ],
      mimeType: "text/plain",
      body: { data: Buffer.from("Hello plain text").toString("base64url") },
    },
    ...overrides,
  }
}

// Import after mocks
const {
  decodeBase64Url,
  getHeader,
  getEmailBody,
  fetchBatched,
  searchThreads,
  getThread,
  sendMessage,
  modifyLabels,
  trashThread,
  getLabels,
  getMessage,
  getAttachment,
  getAttachments,
} = await import("../gmail.js")

describe("decodeBase64Url", () => {
  it("decodes base64url-encoded string", () => {
    const encoded = Buffer.from("Hello, World!").toString("base64url")
    expect(decodeBase64Url(encoded)).toBe("Hello, World!")
  })

  it("handles + and / replacements", () => {
    // base64url uses - and _ instead of + and /
    const input = "SGVsbG8gV29ybGQh"
    expect(decodeBase64Url(input)).toBe("Hello World!")
  })
})

describe("getHeader", () => {
  const message = makeMessage()

  it("finds header case-insensitively", () => {
    expect(getHeader(message, "from")).toBe("alice@example.com")
    expect(getHeader(message, "FROM")).toBe("alice@example.com")
    expect(getHeader(message, "Subject")).toBe("Test subject")
  })

  it("returns empty string for missing header", () => {
    expect(getHeader(message, "X-Custom")).toBe("")
  })

  it("returns empty string when payload is missing", () => {
    expect(getHeader({}, "From")).toBe("")
  })
})

describe("getEmailBody", () => {
  it("extracts plain text body from root payload", () => {
    const message = makeMessage()
    const result = getEmailBody(message)
    expect(result.body).toBe("Hello plain text")
    expect(result.bodyIsHtml).toBe(false)
  })

  it("extracts HTML body from root payload", () => {
    const html = "<p>Hello HTML</p>"
    const message = makeMessage({
      payload: {
        mimeType: "text/html",
        body: { data: Buffer.from(html).toString("base64url") },
      },
    })
    const result = getEmailBody(message)
    expect(result.body).toContain("Hello HTML")
    expect(result.bodyIsHtml).toBe(true)
  })

  it("strips script tags from HTML", () => {
    const html = '<p>Safe</p><script>alert("xss")</script>'
    const message = makeMessage({
      payload: {
        mimeType: "text/html",
        body: { data: Buffer.from(html).toString("base64url") },
      },
    })
    const result = getEmailBody(message)
    expect(result.body).not.toContain("<script")
    expect(result.body).toContain("Safe")
  })

  it("prefers HTML part over text in multipart", () => {
    const message = makeMessage({
      payload: {
        mimeType: "multipart/alternative",
        body: {},
        parts: [
          { mimeType: "text/plain", body: { data: Buffer.from("plain").toString("base64url") } },
          { mimeType: "text/html", body: { data: Buffer.from("<b>html</b>").toString("base64url") } },
        ],
      },
    })
    const result = getEmailBody(message)
    expect(result.bodyIsHtml).toBe(true)
    expect(result.body).toContain("html")
  })

  it("falls back to text part if no HTML", () => {
    const message = makeMessage({
      payload: {
        mimeType: "multipart/mixed",
        body: {},
        parts: [
          { mimeType: "text/plain", body: { data: Buffer.from("fallback text").toString("base64url") } },
        ],
      },
    })
    const result = getEmailBody(message)
    expect(result.body).toBe("fallback text")
    expect(result.bodyIsHtml).toBe(false)
  })

  it("handles nested multipart", () => {
    const message = makeMessage({
      payload: {
        mimeType: "multipart/mixed",
        body: {},
        parts: [
          {
            mimeType: "multipart/alternative",
            body: {},
            parts: [
              { mimeType: "text/html", body: { data: Buffer.from("<i>nested</i>").toString("base64url") } },
            ],
          },
        ],
      },
    })
    const result = getEmailBody(message)
    expect(result.bodyIsHtml).toBe(true)
    expect(result.body).toContain("nested")
  })

  it("returns empty for missing payload", () => {
    const result = getEmailBody({})
    expect(result.body).toBe("")
    expect(result.bodyIsHtml).toBe(false)
  })
})

describe("fetchBatched", () => {
  it("processes items in batches", async () => {
    const fn = vi.fn(async (n: number) => n * 2)
    const result = await fetchBatched([1, 2, 3, 4, 5], fn, 2)
    expect(result).toEqual([2, 4, 6, 8, 10])
    // First batch: items 0-1, second: 2-3, third: 4
    expect(fn).toHaveBeenCalledTimes(5)
  })

  it("handles empty array", async () => {
    const fn = vi.fn(async (n: number) => n)
    const result = await fetchBatched([], fn)
    expect(result).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })

  it("uses default batch size of 5", async () => {
    const calls: number[][] = []
    const fn = vi.fn(async (n: number) => {
      calls.push([n])
      return n
    })
    await fetchBatched([1, 2, 3, 4, 5, 6], fn)
    // 6 items with batch size 5 → 2 batches
    expect(fn).toHaveBeenCalledTimes(6)
  })
})

describe("Gmail API functions", () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  describe("searchThreads", () => {
    it("returns empty threads for no results", async () => {
      mockFetch
        .mockReturnValueOnce(okJson({ threads: null, historyId: "123" }))

      const result = await searchThreads("test-token", "in:inbox")
      expect(result.threads).toEqual([])
      expect(result.nextPageToken).toBeNull()
      expect(result.historyId).toBe("123")
    })

    it("passes query params correctly", async () => {
      mockFetch.mockReturnValueOnce(okJson({ threads: null }))

      await searchThreads("test-token", "label:important", 10, "page2")

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain("q=label%3Aimportant")
      expect(url).toContain("maxResults=10")
      expect(url).toContain("pageToken=page2")
    })
  })

  describe("getThread", () => {
    it("parses thread with messages", async () => {
      mockFetch.mockReturnValueOnce(
        okJson({
          id: "t1",
          messages: [makeMessage(), makeMessage({ id: "msg2" })],
        }),
      )

      const result = await getThread("test-token", "t1")
      expect(result.id).toBe("t1")
      expect(result.messages).toHaveLength(2)
      expect(result.subject).toBe("Test subject")
      expect(result.messageCount).toBe(2)
    })

    it("handles thread with no messages", async () => {
      mockFetch.mockReturnValueOnce(okJson({ id: "t1" }))

      const result = await getThread("test-token", "t1")
      expect(result.messages).toEqual([])
      expect(result.messageCount).toBe(0)
    })
  })

  describe("sendMessage", () => {
    it("sends base64url-encoded message", async () => {
      mockFetch.mockReturnValueOnce(okJson({ id: "sent1" }))

      await sendMessage("test-token", "bob@test.com", "Hi", "Body text")

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain("/messages/send")
      expect(opts.method).toBe("POST")

      const body = JSON.parse(opts.body)
      expect(body.raw).toBeDefined()
      // Decode and verify
      const decoded = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
      expect(decoded).toContain("To: bob@test.com")
      expect(decoded).toContain("Subject: Hi")
      expect(decoded).toContain("Body text")
    })

    it("includes In-Reply-To and References headers", async () => {
      mockFetch.mockReturnValueOnce(okJson({ id: "sent2" }))

      await sendMessage("test-token", "bob@test.com", "Re: Hi", "Reply", "t1", "<orig@id>")

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.threadId).toBe("t1")
      const decoded = Buffer.from(body.raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
      expect(decoded).toContain("In-Reply-To: <orig@id>")
      expect(decoded).toContain("References: <orig@id>")
    })
  })

  describe("modifyLabels", () => {
    it("sends correct modify request", async () => {
      mockFetch.mockReturnValueOnce(okJson({}))

      await modifyLabels("test-token", "msg1", ["STARRED"], ["UNREAD"])

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain("/messages/msg1/modify")
      const body = JSON.parse(opts.body)
      expect(body.addLabelIds).toEqual(["STARRED"])
      expect(body.removeLabelIds).toEqual(["UNREAD"])
    })
  })

  describe("trashThread", () => {
    it("sends trash request to correct endpoint", async () => {
      mockFetch.mockReturnValueOnce(okJson({}))

      await trashThread("test-token", "t1")

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain("/threads/t1/trash")
      expect(opts.method).toBe("POST")
    })
  })

  describe("getLabels", () => {
    it("maps label fields", async () => {
      mockFetch.mockReturnValueOnce(
        okJson({
          labels: [
            { id: "INBOX", name: "INBOX", type: "system", messagesTotal: 100, messagesUnread: 5, extra: true },
          ],
        }),
      )

      const result = await getLabels("test-token")
      expect(result.labels).toEqual([
        { id: "INBOX", name: "INBOX", type: "system", messagesTotal: 100, messagesUnread: 5 },
      ])
    })

    it("handles empty labels", async () => {
      mockFetch.mockReturnValueOnce(okJson({}))

      const result = await getLabels("test-token")
      expect(result.labels).toEqual([])
    })
  })

  describe("getMessage", () => {
    it("fetches and parses a single message", async () => {
      mockFetch.mockReturnValueOnce(okJson(makeMessage()))

      const result = await getMessage("test-token", "msg1")
      expect(result.id).toBe("msg1")
      expect(result.from).toBe("alice@example.com")
      expect(result.body).toBe("Hello plain text")
    })
  })

  describe("getAttachment", () => {
    it("returns decoded attachment buffer", async () => {
      const content = "attachment-content"
      const encoded = Buffer.from(content).toString("base64url")
      mockFetch.mockReturnValueOnce(okJson({ data: encoded }))

      const result = await getAttachment("test-token", "msg1", "att1")
      expect(result.toString()).toBe(content)
    })
  })

  describe("getAttachments", () => {
    it("extracts non-inline file attachments", () => {
      const payload = {
        parts: [
          { mimeType: "text/html", body: { data: "abc" } },
          {
            filename: "report.pdf",
            mimeType: "application/pdf",
            body: { attachmentId: "att-pdf", size: 12345 },
          },
          {
            filename: "photo.png",
            mimeType: "image/png",
            body: { attachmentId: "att-img", size: 5000 },
            headers: [{ name: "Content-ID", value: "<img001@example>" }],
          },
        ],
      }

      const result = getAttachments(payload)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        attachmentId: "att-pdf",
        filename: "report.pdf",
        mimeType: "application/pdf",
        size: 12345,
      })
    })

    it("returns empty array when no attachments", () => {
      const payload = {
        mimeType: "text/plain",
        body: { data: "abc" },
      }
      expect(getAttachments(payload)).toEqual([])
    })

    it("includes non-image attachments with Content-ID", () => {
      const payload = {
        parts: [
          {
            filename: "data.csv",
            mimeType: "text/csv",
            body: { attachmentId: "att-csv", size: 200 },
            headers: [{ name: "Content-ID", value: "<csv@example>" }],
          },
        ],
      }

      const result = getAttachments(payload)
      expect(result).toHaveLength(1)
      expect(result[0].filename).toBe("data.csv")
    })

    it("walks nested multipart structures", () => {
      const payload = {
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: "abc" } },
              { mimeType: "text/html", body: { data: "def" } },
            ],
          },
          {
            filename: "doc.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            body: { attachmentId: "att-docx", size: 98765 },
          },
        ],
      }

      const result = getAttachments(payload)
      expect(result).toHaveLength(1)
      expect(result[0].filename).toBe("doc.docx")
    })
  })

  it("throws on non-ok response", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("Unauthorized") }),
    )

    await expect(getLabels("test-token")).rejects.toThrow("Gmail API 401: Unauthorized")
  })
})
