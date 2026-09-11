import TurndownService from "turndown"
import { gfmTables } from "@hammies/frontend/lib/turndown-gfm-tables"

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

td.remove(["style", "script", "head"])

// GFM tables. Shared rather than local: nothing about them is mail-specific,
// and a `<table>` flattened to one line per cell loses the row-to-column
// pairing outright — data, not styling. The plugin stays conservative about
// what counts as a table, because HTML email uses them for layout constantly.
td.use(gfmTables)

// cid: images that weren't replaced by replaceCidReferences should be dropped
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

// Strip Microsoft auto-generated alt text ("Description automatically generated")
td.addRule("images", {
  filter(node) {
    if (node.nodeName !== "IMG") return false
    const src = (node as HTMLImageElement).getAttribute("src") || ""
    return src.startsWith("/api/") || src.startsWith("http")
  },
  replacement(_content, node) {
    const el = node as HTMLImageElement
    const src = el.getAttribute("src") || ""
    let alt = el.getAttribute("alt") || ""
    if (/description automatically generated/i.test(alt)) alt = ""
    return src ? `![${alt}](${src})` : ""
  },
})

export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return ""

  let md = td.turndown(html)

  // Strip leftover cid: references that leaked through links wrapping stripped images:
  // linked cid images: [cid:logo.png@01D](https://...) or [![](cid:...)](url)
  // empty links from stripped cid images: [](https://...)
  // bare cid text: cid:image001.png@01DCB162
  md = md.replace(/!?\[cid:[^\]]*\]\([^)]*\)/g, "")
  md = md.replace(/(?<!!)\[]\([^)]*\)/g, "")
  md = md.replace(/\bcid:\S+/g, "")

  md = md.replace(/^[ \t]*&nbsp;[ \t]*$/gm, "")
  md = md.replace(/\n{3,}/g, "\n\n")

  return md.trim()
}
