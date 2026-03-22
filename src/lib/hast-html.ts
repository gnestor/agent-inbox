/** Minimal HAST node type for lowlight output */
export interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: { className?: string[] }
  children?: HastNode[]
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function nodeToHtml(node: HastNode): string {
  if (node.type === "text") return escapeHtml(node.value || "")
  if (node.type === "element" && node.tagName === "span") {
    const cls = node.properties?.className?.join(" ") || ""
    const inner = (node.children || []).map(nodeToHtml).join("")
    return cls ? `<span class="${escapeHtml(cls)}">${inner}</span>` : `<span>${inner}</span>`
  }
  if (node.children) return node.children.map(nodeToHtml).join("")
  return escapeHtml(node.value || "")
}

export function hastToHtml(tree: { children: HastNode[] }): string {
  return tree.children.map(nodeToHtml).join("")
}
