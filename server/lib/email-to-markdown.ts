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

  // Strip style/script blocks before feeding to turndown (belt-and-suspenders)
  let cleaned = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")

  let md = td.turndown(cleaned)

  // Collapse runs of 3+ blank lines down to 2
  md = md.replace(/\n{3,}/g, "\n\n")

  // Strip lines that are only whitespace or &nbsp;
  md = md
    .split("\n")
    .filter((line) => line.trim() !== "&nbsp;" && !/^\s*$/.test(line) || line === "")
    .join("\n")

  // Final collapse after filter
  md = md.replace(/\n{3,}/g, "\n\n")

  return md.trim()
}
