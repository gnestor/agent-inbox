import { forwardRef, useImperativeHandle, useRef, useState } from "react"
import { createPortal } from "react-dom"

export interface SlashCommandItem {
  title: string
  description: string
  icon: string
  command: (props: { editor: any; range: any }) => void
}

interface SlashCommandMenuProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
  clientRect: (() => DOMRect | null) | null
}

export const SlashCommandMenu = forwardRef<
  { onKeyDown: (e: KeyboardEvent) => boolean },
  SlashCommandMenuProps
>(({ items, command, clientRect }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Reset selection when items change (render-time, no effect needed)
  const prevItemsRef = useRef(items)
  if (prevItemsRef.current !== items) {
    prevItemsRef.current = items
    setSelectedIndex(0)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") {
        setSelectedIndex((i) => (i <= 0 ? items.length - 1 : i - 1))
        return true
      }
      if (e.key === "ArrowDown") {
        setSelectedIndex((i) => (i >= items.length - 1 ? 0 : i + 1))
        return true
      }
      if (e.key === "Enter") {
        if (items[selectedIndex]) command(items[selectedIndex])
        return true
      }
      return false
    },
  }))

  if (!items.length || !clientRect) return null

  const rect = clientRect()
  if (!rect) return null

  const style: React.CSSProperties = {
    position: "fixed",
    top: rect.bottom + 4,
    left: rect.left,
    zIndex: 9999,
  }

  return createPortal(
    <div
      style={style}
      className="min-w-[220px] rounded-lg border border-border bg-popover shadow-lg overflow-hidden py-1"
    >
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
          className={`flex items-center gap-2.5 w-full px-3 py-1.5 text-sm text-left transition-colors ${
            i === selectedIndex ? "bg-accent text-foreground" : "text-foreground hover:bg-secondary"
          }`}
          onMouseEnter={() => setSelectedIndex(i)}
          onClick={() => command(item)}
        >
          <span className="text-base shrink-0">{item.icon}</span>
          <div>
            <div className="font-medium leading-tight">{item.title}</div>
            <div className="text-xs text-muted-foreground leading-tight">{item.description}</div>
          </div>
        </button>
      ))}
    </div>,
    document.body,
  )
})

SlashCommandMenu.displayName = "SlashCommandMenu"

export const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: "H₁",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run(),
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: "H₂",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    icon: "H₃",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    title: "Bullet List",
    description: "Unordered list of items",
    icon: "•",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "Numbered List",
    description: "Ordered list of items",
    icon: "1.",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "Task List",
    description: "Checklist with checkboxes",
    icon: "☑",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: "Code Block",
    description: "Syntax-highlighted code",
    icon: "</>",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    title: "Quote",
    description: "Blockquote / callout",
    icon: "❝",
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setBlockquote().run(),
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    icon: "─",
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
]
