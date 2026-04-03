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

td.remove(["style", "script", "head"])

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
