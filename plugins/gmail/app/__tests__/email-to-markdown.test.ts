import { describe, it, expect } from "vitest"
import { htmlToMarkdown } from "../lib/email-to-markdown.js"

describe("htmlToMarkdown", () => {
  it("converts simple paragraph to markdown", () => {
    const result = htmlToMarkdown("<p>Hello world</p>")
    expect(result.trim()).toBe("Hello world")
  })

  it("returns empty string for empty input", () => {
    expect(htmlToMarkdown("")).toBe("")
  })

  it("converts bold text", () => {
    const result = htmlToMarkdown("<p><strong>Bold</strong> text</p>")
    expect(result).toContain("**Bold**")
  })

  it("converts italic text", () => {
    const result = htmlToMarkdown("<p><em>Italic</em> text</p>")
    expect(result).toContain("*Italic*")
  })

  it("converts hyperlinks", () => {
    const result = htmlToMarkdown('<p><a href="https://example.com">Click here</a></p>')
    expect(result).toContain("[Click here](https://example.com)")
  })

  it("converts unordered lists", () => {
    const result = htmlToMarkdown("<ul><li>Item 1</li><li>Item 2</li></ul>")
    // Turndown may emit "- " or "-   " (both valid markdown)
    expect(result).toMatch(/-\s+Item 1/)
    expect(result).toMatch(/-\s+Item 2/)
  })

  it("converts ordered lists", () => {
    const result = htmlToMarkdown("<ol><li>First</li><li>Second</li></ol>")
    // Turndown may emit "1. " or "1.  " (both valid markdown)
    expect(result).toMatch(/1\.\s+First/)
    expect(result).toMatch(/2\.\s+Second/)
  })

  it("converts headings", () => {
    const result = htmlToMarkdown("<h1>Title</h1>")
    expect(result).toContain("# Title")
  })

  it("converts inline images with src", () => {
    const result = htmlToMarkdown('<img src="/api/gmail/messages/123/attachments/att1" alt="photo">')
    expect(result).toContain("![photo](/api/gmail/messages/123/attachments/att1)")
  })

  it("strips Microsoft auto-generated alt text", () => {
    const result = htmlToMarkdown(
      '<img src="/api/gmail/messages/123/attachments/att1" alt="A black and white sign with white text Description automatically generated">'
    )
    expect(result).toContain("![](/api/gmail/messages/123/attachments/att1)")
    expect(result).not.toContain("Description automatically generated")
  })

  it("strips cid: images (not yet proxied)", () => {
    const result = htmlToMarkdown('<img src="cid:image001@example.com">')
    expect(result).not.toContain("cid:")
  })

  it("strips cid images wrapped in links", () => {
    const result = htmlToMarkdown('<a href="https://example.com"><img src="cid:logo.png@01D"></a>')
    expect(result).not.toContain("cid:")
    expect(result).toBe("")
  })

  it("strips bare cid: text references", () => {
    const result = htmlToMarkdown("<p>cid:betterpackaging_horizontal_pos_rgb.png</p>")
    expect(result).not.toContain("cid:")
  })

  it("preserves valid images with empty alt text", () => {
    const result = htmlToMarkdown('<img src="/api/gmail/messages/123/attachments/att1" alt="">')
    expect(result).toContain("![](/api/gmail/messages/123/attachments/att1)")
  })

  it("converts br to line break", () => {
    const result = htmlToMarkdown("Line 1<br>Line 2")
    expect(result).toContain("Line 1")
    expect(result).toContain("Line 2")
  })

  it("strips style tags entirely", () => {
    const result = htmlToMarkdown("<style>.foo { color: red; }</style><p>Content</p>")
    expect(result).not.toContain(".foo")
    expect(result).toContain("Content")
  })

  it("strips script tags entirely", () => {
    const result = htmlToMarkdown("<script>alert('xss')</script><p>Safe</p>")
    expect(result).not.toContain("alert")
    expect(result).toContain("Safe")
  })

  it("handles tables", () => {
    const result = htmlToMarkdown("<table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table>")
    expect(result).toContain("Name")
    expect(result).toContain("Alice")
  })

  it("handles div-based layout with plain text", () => {
    const result = htmlToMarkdown("<div>Hello</div><div>World</div>")
    expect(result).toContain("Hello")
    expect(result).toContain("World")
  })

  it("handles HTML with only whitespace and nbsp", () => {
    const result = htmlToMarkdown("<p>&nbsp;</p>")
    expect(result.trim()).toBe("")
  })

  it("preserves proxy image URLs", () => {
    const html = '<img src="/api/gmail/messages/abc/attachments/xyz" alt="">'
    const result = htmlToMarkdown(html)
    expect(result).toContain("/api/gmail/messages/abc/attachments/xyz")
  })

  it("collapses excessive blank lines", () => {
    const result = htmlToMarkdown("<p>First</p><p></p><p></p><p>Second</p>")
    // Should not have more than 2 consecutive blank lines
    expect(result).not.toMatch(/\n{4,}/)
  })

  it("Scenario: a tabular table becomes a GFM table", () => {
    const html =
      "<table><thead><tr><th>NDC</th><th>Order Due</th></tr></thead>" +
      "<tbody><tr><td>November 10</td><td>10/27 for ATS</td></tr></tbody></table>"
    expect(htmlToMarkdown(html)).toBe(
      ["| NDC | Order Due |", "| --- | --- |", "| November 10 | 10/27 for ATS |"].join("\n"),
    )

    // HTML email uses tables for layout constantly; rendering that scaffolding
    // as pipes would read worse than the flattening it replaced.
    const layout = "<table><tbody><tr><td><p>Logo</p></td></tr><tr><td><p>Body copy</p></td></tr></tbody></table>"
    expect(htmlToMarkdown(layout)).not.toContain("| --- |")

    // Rectangular, so shape alone would accept it; the document said otherwise.
    const presentational =
      '<table role="presentation"><tbody><tr><td>logo</td><td>Big News</td></tr><tr><td>shop</td><td>about</td></tr></tbody></table>'
    expect(htmlToMarkdown(presentational)).not.toContain("| --- |")
  })

  it("Scenario: the Gmail-specific rules still run alongside the shared table rules", () => {
    const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td><img src="cid:logo.png"></td><td>x</td></tr></tbody></table>'
    const result = htmlToMarkdown(html)
    expect(result).toContain("| --- |")
    expect(result).not.toContain("cid:")
  })
})
