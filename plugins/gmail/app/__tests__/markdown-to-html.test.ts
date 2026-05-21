import { describe, expect, it } from "vitest"
import { markdownToHtml } from "../lib/gmail"

describe("markdownToHtml", () => {
  it("strips CommonMark backslash escapes from punctuation", () => {
    expect(markdownToHtml("foo\\.bar")).toContain("foo.bar")
    expect(markdownToHtml("foo\\.bar")).not.toContain("\\")
  })

  it("renders backslash-escaped numbered items as a real ordered list", () => {
    const md = "1\\. First item\n\n2\\. Second item\n\n3\\. Third item"
    const html = markdownToHtml(md)
    expect(html).toContain("<ol>")
    expect(html.match(/<li>/g)).toHaveLength(3)
    expect(html).toContain("<li>First item</li>")
    expect(html).toContain("<li>Third item</li>")
    expect(html).not.toContain("\\")
  })

  it("merges adjacent ordered list blocks separated by blank lines", () => {
    const md = "1. First\n\n2. Second"
    const html = markdownToHtml(md)
    expect(html.match(/<ol>/g)).toHaveLength(1)
    expect(html.match(/<li>/g)).toHaveLength(2)
  })

  it("merges adjacent unordered list blocks separated by blank lines", () => {
    const md = "- First\n\n- Second"
    const html = markdownToHtml(md)
    expect(html.match(/<ul>/g)).toHaveLength(1)
    expect(html.match(/<li>/g)).toHaveLength(2)
  })
})
