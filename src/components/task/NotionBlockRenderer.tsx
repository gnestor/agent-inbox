import { useMemo } from "react"
import { cn } from "@hammies/frontend/lib/utils"
import { common, createLowlight } from "lowlight"

const lowlight = createLowlight(common)

// --- Types ---

interface RichTextItem {
  type: string
  text?: { content: string; link?: { url: string } | null }
  mention?: {
    type: string
    page?: { id: string }
    user?: { name?: string; id: string }
    date?: { start: string; end?: string }
    link_preview?: { url: string }
    link_mention?: {
      href: string
      title?: string
      description?: string
      icon_url?: string
    }
  }
  annotations?: {
    bold?: boolean
    italic?: boolean
    strikethrough?: boolean
    underline?: boolean
    code?: boolean
    color?: string
  }
  plain_text: string
  href?: string | null
}

interface NotionBlock {
  id: string
  type: string
  has_children?: boolean
  children?: NotionBlock[]
  [key: string]: unknown
}

// --- Rich Text ---

function RichText({ items }: { items: RichTextItem[] }) {
  if (!items?.length) return null

  return (
    <>
      {items.map((item, i) => {
        const ann = item.annotations || {}
        const classes = cn(
          ann.bold && "font-semibold",
          ann.italic && "italic",
          ann.strikethrough && "line-through",
          ann.underline && "underline",
          ann.code &&
            "notion-inline-code bg-[hsl(var(--muted))] px-[0.4em] py-[0.2em] rounded-[3px] text-[0.85em] font-mono text-[#eb5757] dark:text-[#ff7b72]",
          ann.color && ann.color !== "default" && colorClass(ann.color),
        )

        let content: React.ReactNode = item.plain_text

        if (item.type === "mention") {
          const m = item.mention
          if (m?.type === "link_mention" && m.link_mention?.href) {
            content = (
              <a
                href={m.link_mention.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary"
              >
                {m.link_mention.title || item.plain_text}
              </a>
            )
          } else if (m?.type === "page" && item.href) {
            content = (
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary"
              >
                <svg
                  className="h-[1em] w-[1em] shrink-0 opacity-60"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M4.5 1A1.5 1.5 0 003 2.5v11A1.5 1.5 0 004.5 15h7a1.5 1.5 0 001.5-1.5v-8L8.5 1H4.5zM8 2l4 4H8V2z" />
                </svg>
                {item.plain_text}
              </a>
            )
          } else if (m?.type === "user") {
            content = (
              <span className="bg-primary/10 text-primary px-1 rounded">
                @{item.plain_text}
              </span>
            )
          } else if (m?.type === "date") {
            content = (
              <span className="bg-[hsl(var(--muted))] px-1.5 py-0.5 rounded text-muted-foreground">
                {item.plain_text}
              </span>
            )
          } else if (m?.type === "link_preview" && m.link_preview?.url) {
            content = (
              <a
                href={m.link_preview.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary"
              >
                {item.plain_text}
              </a>
            )
          } else if (item.href) {
            content = (
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary"
              >
                {item.plain_text}
              </a>
            )
          }
        }

        if (item.href && item.type === "text") {
          content = (
            <a
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary"
            >
              {item.plain_text}
            </a>
          )
        }

        return classes ? (
          <span key={i} className={classes}>
            {content}
          </span>
        ) : (
          <span key={i}>{content}</span>
        )
      })}
    </>
  )
}

function colorClass(color: string): string {
  const map: Record<string, string> = {
    gray: "text-[#9b9a97] dark:text-[#979a9b]",
    brown: "text-[#64473a] dark:text-[#937264]",
    orange: "text-[#d9730d] dark:text-[#ffa344]",
    yellow: "text-[#dfab01] dark:text-[#ffdc49]",
    green: "text-[#0f7b6c] dark:text-[#4dab9a]",
    blue: "text-[#0b6e99] dark:text-[#529cca]",
    purple: "text-[#6940a5] dark:text-[#9a6dd7]",
    pink: "text-[#ad1a72] dark:text-[#e255a1]",
    red: "text-[#e03e3e] dark:text-[#ff7369]",
    gray_background: "bg-[#ebeced] dark:bg-[#454b4e]",
    brown_background: "bg-[#e9e5e3] dark:bg-[#434040]",
    orange_background: "bg-[#faebdd] dark:bg-[#594a3a]",
    yellow_background: "bg-[#fbf3db] dark:bg-[#59563b]",
    green_background: "bg-[#ddedea] dark:bg-[#354c4b]",
    blue_background: "bg-[#ddebf1] dark:bg-[#364954]",
    purple_background: "bg-[#eae4f2] dark:bg-[#443f57]",
    pink_background: "bg-[#f4dfeb] dark:bg-[#533b4c]",
    red_background: "bg-[#fbe4e4] dark:bg-[#594141]",
  }
  return map[color] || ""
}

// --- Syntax Highlighting ---

type HastNode = {
  type: string
  value?: string
  tagName?: string
  properties?: { className?: string[] }
  children?: HastNode[]
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function nodeToHtml(node: HastNode): string {
  if (node.type === "text") return escapeHtml(node.value || "")
  if (node.type === "element" && node.tagName === "span") {
    const cls = node.properties?.className?.join(" ") || ""
    const inner = (node.children || []).map(nodeToHtml).join("")
    return cls
      ? `<span class="${escapeHtml(cls)}">${inner}</span>`
      : `<span>${inner}</span>`
  }
  if (node.children) return node.children.map(nodeToHtml).join("")
  return escapeHtml(node.value || "")
}

function hastToHtml(tree: { children: HastNode[] }): string {
  return tree.children.map(nodeToHtml).join("")
}

function HighlightedCode({
  code,
  language,
}: {
  code: string
  language?: string
}) {
  const highlighted = useMemo(() => {
    try {
      if (language && lowlight.registered(language)) {
        return hastToHtml(lowlight.highlight(language, code))
      }
      return hastToHtml(lowlight.highlightAuto(code))
    } catch {
      return escapeHtml(code)
    }
  }, [code, language])

  // Safe: lowlight generates structured HAST nodes from code strings,
  // and escapeHtml sanitizes all text content. No user HTML is passed through.
  return <code dangerouslySetInnerHTML={{ __html: highlighted }} />
}

// --- Children helper ---

function BlockChildren({ children }: { children?: NotionBlock[] }) {
  if (!children?.length) return null
  return (
    <div className="pl-[1.5em] mt-1">
      <NotionBlockRenderer blocks={children} />
    </div>
  )
}

// --- Block components ---

function ParagraphBlock({ block }: { block: NotionBlock }) {
  const data = block.paragraph as { rich_text: RichTextItem[] }
  if (!data?.rich_text?.length) return <div className="min-h-[1.5em] my-px" />
  return (
    <div className="my-px">
      <p>
        <RichText items={data.rich_text} />
      </p>
      <BlockChildren children={block.children} />
    </div>
  )
}

function HeadingBlock({
  block,
  level,
}: {
  block: NotionBlock
  level: 1 | 2 | 3
}) {
  const key = `heading_${level}` as string
  const data = block[key] as {
    rich_text: RichTextItem[]
    is_toggleable?: boolean
  }
  const sizes = {
    1: "notion-h1 text-[1.875em] font-bold leading-[1.3] mt-[2em] mb-[1px]",
    2: "notion-h2 text-[1.5em] font-semibold leading-[1.3] mt-[1.4em] mb-[1px]",
    3: "notion-h3 text-[1.25em] font-semibold leading-[1.3] mt-[1em] mb-[1px]",
  }

  if (data?.is_toggleable || block.has_children) {
    return (
      <details className="group" open={false}>
        <summary
          className={cn(
            sizes[level],
            "cursor-pointer list-none flex items-start gap-0.5 [&::-webkit-details-marker]:hidden",
          )}
        >
          <span className="text-[0.65em] text-muted-foreground group-open:rotate-90 transition-transform duration-200 mt-[0.25em] shrink-0 select-none">
            ▶
          </span>
          <span>
            <RichText items={data?.rich_text || []} />
          </span>
        </summary>
        <BlockChildren children={block.children} />
      </details>
    )
  }

  const Tag = `h${level}` as "h1" | "h2" | "h3"
  return (
    <Tag className={sizes[level]}>
      <RichText items={data?.rich_text || []} />
    </Tag>
  )
}

function BulletedListItemBlock({ block }: { block: NotionBlock }) {
  const data = block.bulleted_list_item as { rich_text: RichTextItem[] }
  return (
    <div className="flex items-start gap-[0.4em] pl-[2px] my-px">
      <span className="mt-[0.55em] h-[0.35em] w-[0.35em] rounded-full bg-current shrink-0 opacity-70" />
      <div className="min-w-0 flex-1">
        <RichText items={data?.rich_text || []} />
        <BlockChildren children={block.children} />
      </div>
    </div>
  )
}

function NumberedListItemBlock({
  block,
  index,
}: {
  block: NotionBlock
  index: number
}) {
  const data = block.numbered_list_item as { rich_text: RichTextItem[] }
  return (
    <div className="flex items-start gap-[0.4em] pl-[2px] my-px">
      <span className="text-muted-foreground tabular-nums shrink-0 min-w-[1.5em]">
        {index}.
      </span>
      <div className="min-w-0 flex-1">
        <RichText items={data?.rich_text || []} />
        <BlockChildren children={block.children} />
      </div>
    </div>
  )
}

function ToDoBlock({ block }: { block: NotionBlock }) {
  const data = block.to_do as {
    rich_text: RichTextItem[]
    checked: boolean
  }
  return (
    <div className="my-px">
      <div className="flex items-start gap-[0.5em]">
        <input
          type="checkbox"
          checked={data?.checked}
          readOnly
          className="mt-[0.3em] h-[1.1em] w-[1.1em] shrink-0 accent-primary cursor-default"
        />
        <span
          className={cn(
            data?.checked && "line-through text-muted-foreground",
          )}
        >
          <RichText items={data?.rich_text || []} />
        </span>
      </div>
      <BlockChildren children={block.children} />
    </div>
  )
}

function QuoteBlock({ block }: { block: NotionBlock }) {
  const data = block.quote as { rich_text: RichTextItem[] }
  return (
    <blockquote className="border-l-[3px] border-current pl-[0.9em] my-px my-2">
      <RichText items={data?.rich_text || []} />
      <BlockChildren children={block.children} />
    </blockquote>
  )
}

function CalloutBlock({ block }: { block: NotionBlock }) {
  const data = block.callout as {
    rich_text: RichTextItem[]
    icon?: { type: string; emoji?: string }
  }
  return (
    <div className="flex gap-[0.6em] rounded-[3px] bg-[hsl(var(--muted)/0.5)] p-[0.75em_0.75em] border border-border/40 my-2">
      {data?.icon?.emoji && (
        <span className="text-[1.2em] leading-[1.4] shrink-0">
          {data.icon.emoji}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <RichText items={data?.rich_text || []} />
        <BlockChildren children={block.children} />
      </div>
    </div>
  )
}

function CodeBlock({ block }: { block: NotionBlock }) {
  const data = block.code as {
    rich_text: RichTextItem[]
    language?: string
    caption?: RichTextItem[]
  }
  const text = data?.rich_text?.map((t) => t.plain_text).join("") || ""
  const lang = data?.language?.toLowerCase()

  return (
    <div className="notion-code rounded-[4px] bg-[#f7f6f3] dark:bg-[#1e1e1e] overflow-hidden border border-border/30 my-2">
      <pre className="p-[2em_1.2em_1.2em] text-[0.875em] font-mono leading-[1.6] overflow-x-auto">
        <HighlightedCode code={text} language={lang} />
      </pre>
      {data?.language && (
        <div className="px-[1.2em] pb-[0.8em] text-[0.75em] text-muted-foreground capitalize">
          {data.language}
        </div>
      )}
    </div>
  )
}

function DividerBlock() {
  return <hr className="border-border my-[8px]" />
}

function ImageBlock({ block }: { block: NotionBlock }) {
  const data = block.image as {
    type: string
    file?: { url: string; expiry_time?: string }
    external?: { url: string }
    caption?: RichTextItem[]
  }
  const url = data?.type === "file" ? data.file?.url : data?.external?.url
  if (!url) return null
  return (
    <figure className="space-y-[0.4em] my-2">
      <img
        src={url}
        alt={data?.caption?.map((t) => t.plain_text).join("") || ""}
        className="max-w-full rounded-[4px]"
        loading="lazy"
      />
      {data?.caption && data.caption.length > 0 && (
        <figcaption className="text-[0.875em] text-muted-foreground text-center">
          <RichText items={data.caption} />
        </figcaption>
      )}
    </figure>
  )
}

function BookmarkBlock({ block }: { block: NotionBlock }) {
  const data = block.bookmark as { url: string; caption?: RichTextItem[] }
  if (!data?.url) return null
  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-[3px] border border-border p-[0.8em_1em] text-[0.875em] text-primary hover:bg-muted/50 truncate"
    >
      {data.url}
    </a>
  )
}

function ToggleBlock({ block }: { block: NotionBlock }) {
  const data = block.toggle as { rich_text: RichTextItem[] }
  return (
    <details className="group my-px">
      <summary className="cursor-pointer list-none flex items-start gap-0.5 [&::-webkit-details-marker]:hidden">
        <span className="text-[0.65em] text-muted-foreground group-open:rotate-90 transition-transform duration-200 mt-[0.3em] shrink-0 select-none">
          ▶
        </span>
        <span>
          <RichText items={data?.rich_text || []} />
        </span>
      </summary>
      <BlockChildren children={block.children} />
    </details>
  )
}

function TableBlock({ block }: { block: NotionBlock }) {
  const data = block.table as {
    table_width: number
    has_column_header: boolean
    has_row_header: boolean
  }
  const rows = (block.children || []) as NotionBlock[]
  if (!rows.length) return null

  return (
    <div className="overflow-x-auto rounded-[3px] border border-border my-2">
      <table className="w-full text-[0.9em] border-collapse">
        <tbody>
          {rows.map((row, rowIdx) => {
            const cells =
              (row.table_row as { cells: RichTextItem[][] })?.cells || []
            const isHeader = data?.has_column_header && rowIdx === 0
            return (
              <tr
                key={row.id}
                className={cn(
                  rowIdx !== rows.length - 1 && "border-b border-border",
                  isHeader && "bg-[hsl(var(--muted)/0.5)]",
                )}
              >
                {cells.map((cell, cellIdx) => {
                  const isRowHeader = data?.has_row_header && cellIdx === 0
                  const Tag = isHeader || isRowHeader ? "th" : "td"
                  return (
                    <Tag
                      key={cellIdx}
                      className={cn(
                        "px-[0.75em] py-[0.45em] text-left align-top",
                        cellIdx !== cells.length - 1 &&
                          "border-r border-border",
                        (isHeader || isRowHeader) && "font-medium",
                      )}
                    >
                      <RichText items={cell} />
                    </Tag>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// --- Main renderer ---

export function NotionBlockRenderer({ blocks }: { blocks: NotionBlock[] }) {
  if (!blocks?.length) {
    return <span className="text-muted-foreground">No content</span>
  }

  let numberedCounter = 0

  return (
    <div className="notion-content text-[0.9375rem] leading-[1.5] flex flex-col gap-px">
      {blocks.map((block) => {
        if (block.type !== "numbered_list_item") {
          numberedCounter = 0
        }
        if (block.type === "numbered_list_item") {
          numberedCounter++
        }

        switch (block.type) {
          case "paragraph":
            return <ParagraphBlock key={block.id} block={block} />
          case "heading_1":
            return <HeadingBlock key={block.id} block={block} level={1} />
          case "heading_2":
            return <HeadingBlock key={block.id} block={block} level={2} />
          case "heading_3":
            return <HeadingBlock key={block.id} block={block} level={3} />
          case "bulleted_list_item":
            return <BulletedListItemBlock key={block.id} block={block} />
          case "numbered_list_item":
            return (
              <NumberedListItemBlock
                key={block.id}
                block={block}
                index={numberedCounter}
              />
            )
          case "to_do":
            return <ToDoBlock key={block.id} block={block} />
          case "quote":
            return <QuoteBlock key={block.id} block={block} />
          case "callout":
            return <CalloutBlock key={block.id} block={block} />
          case "code":
            return <CodeBlock key={block.id} block={block} />
          case "divider":
            return <DividerBlock key={block.id} />
          case "image":
            return <ImageBlock key={block.id} block={block} />
          case "bookmark":
            return <BookmarkBlock key={block.id} block={block} />
          case "toggle":
            return <ToggleBlock key={block.id} block={block} />
          case "table":
            return <TableBlock key={block.id} block={block} />
          default:
            return null
        }
      })}
    </div>
  )
}
