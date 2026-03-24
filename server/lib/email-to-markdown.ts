/**
 * Converts sanitized email HTML to markdown using turndown.
 * Should be called AFTER sanitizeHtmlEmail() so quotes/signatures are already stripped.
 */

import TurndownService from "turndown"

const td = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
})

// Remove style and script elements entirely
td.remove(["style", "script", "head"])

// Strip cid: images (un-proxied inline images) rather than emit broken markdown
td.addRule("cid-images", {
  filter(node) {
    return (
      node.nodeName === "IMG" &&
      (node as HTMLImageElement).getAttribute("src")?.startsWith("cid:") === true
    )
  },
  replacement() {
    return ""
  },
})

// Preserve proxy images (already converted from cid: by replaceCidReferences)
td.addRule("proxy-images", {
  filter(node) {
    if (node.nodeName !== "IMG") return false
    const src = (node as HTMLImageElement).getAttribute("src") || ""
    return src.startsWith("/api/") || src.startsWith("http")
  },
  replacement(_content, node) {
    const el = node as HTMLImageElement
    const src = el.getAttribute("src") || ""
    const alt = el.getAttribute("alt") || ""
    return src ? `![${alt}](${src})` : ""
  },
})

/**
 * Convert sanitized email HTML to markdown.
 * Input should already have quotes/signatures stripped by sanitizeHtmlEmail().
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return ""

  let md = td.turndown(html)

  // Strip lines that are only &nbsp; or whitespace, then collapse blank runs
  md = md.replace(/^[ \t]*&nbsp;[ \t]*$/gm, "")
  md = md.replace(/\n{3,}/g, "\n\n")

  return md.trim()
}
