import { useEffect, useMemo, useRef } from "react"
import { EditorContent, ReactRenderer, useEditor } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import { TaskList } from "@tiptap/extension-task-list"
import { TaskItem } from "@tiptap/extension-task-item"
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import Link from "@tiptap/extension-link"
import { Extension } from "@tiptap/core"
import Suggestion from "@tiptap/suggestion"
import { Markdown } from "tiptap-markdown"
import { common, createLowlight } from "lowlight"
import { Bold, Italic, Strikethrough, Code, Link as LinkIcon } from "lucide-react"
import { SlashCommandMenu, SLASH_COMMANDS } from "./SlashCommandMenu"
import "./rich-text-editor.css"

const lowlight = createLowlight(common)

// ── Slash command extension ──────────────────────────────────────────────────

function createSlashCommandExtension(onCmdEnterRef: React.RefObject<(() => void) | undefined>) {
  return Extension.create({
    name: "slashCommand",

    addKeyboardShortcuts() {
      return {
        "Mod-Enter": () => {
          onCmdEnterRef.current?.()
          return true
        },
      }
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: "/",
          allowSpaces: false,
          startOfLine: false,
          items: ({ query }: { query: string }) => {
            const q = query.toLowerCase()
            return q
              ? SLASH_COMMANDS.filter((item) => item.title.toLowerCase().includes(q))
              : SLASH_COMMANDS
          },
          render: () => {
            let component: ReactRenderer<any>
            return {
              onStart: (props: any) => {
                component = new ReactRenderer(SlashCommandMenu, {
                  props: {
                    ...props,
                    command: (item: any) => {
                      props.command(item)
                    },
                    clientRect: props.clientRect,
                  },
                  editor: props.editor,
                })
                document.body.appendChild(component.element)
              },
              onUpdate: (props: any) => {
                component.updateProps({
                  ...props,
                  command: (item: any) => {
                    props.command(item)
                  },
                  clientRect: props.clientRect,
                })
              },
              onKeyDown: (props: any) => {
                if (props.event.key === "Escape") {
                  component.destroy()
                  component.element.remove()
                  return true
                }
                return (component.ref as any)?.onKeyDown(props.event) ?? false
              },
              onExit: () => {
                component.element.remove()
                component.destroy()
              },
            }
          },
          command: ({ editor, range, props }: { editor: any; range: any; props: any }) => {
            props.command({ editor, range })
          },
        }),
      ]
    },
  })
}

// ── RichTextEditor ────────────────────────────────────────────────────────────

interface RichTextEditorProps {
  value: string
  onChange: (markdown: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  onCmdEnter?: () => void
  autofocus?: boolean
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Start typing...",
  disabled = false,
  className = "",
  onCmdEnter,
  autofocus = false,
}: RichTextEditorProps) {
  const onCmdEnterRef = useRef<(() => void) | undefined>(onCmdEnter)
  useEffect(() => {
    onCmdEnterRef.current = onCmdEnter
  }, [onCmdEnter])

  // Track last emitted markdown to avoid cursor reset on external updates
  const lastEmittedRef = useRef<string>(value)

  // Memoize extensions — onCmdEnterRef is stable, so no deps needed
  const extensions = useMemo(
    () => [
      StarterKit.configure({ codeBlock: false }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight }),
      Link.configure({ openOnClick: false }),
      Markdown.configure({
        html: false,
        tightLists: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      createSlashCommandExtension(onCmdEnterRef as React.RefObject<(() => void) | undefined>),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const editor = useEditor({
    extensions,
    content: value,
    editable: !disabled,
    autofocus: autofocus ? "end" : false,
    onUpdate: ({ editor }) => {
      const md = (editor.storage as any).markdown.getMarkdown() as string
      lastEmittedRef.current = md
      onChange(md)
    },
  })

  // Sync external value changes (e.g. loading a template)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (value === lastEmittedRef.current) return
    lastEmittedRef.current = value
    editor.commands.setContent(value, { emitUpdate: false })
  }, [editor, value])

  // Sync disabled
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!disabled)
  }, [editor, disabled])

  return (
    <div
      className={`relative rounded-md border border-input bg-background ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${disabled ? "opacity-50 pointer-events-none" : ""} ${className}`}
    >
      {editor && (
        <BubbleMenu editor={editor} className="rich-text-bubble-menu">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive("bold") ? "is-active" : ""}
            title="Bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive("italic") ? "is-active" : ""}
            title="Italic"
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={editor.isActive("strike") ? "is-active" : ""}
            title="Strikethrough"
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </button>
          <div className="separator" />
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={editor.isActive("code") ? "is-active" : ""}
            title="Inline code"
          >
            <Code className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              const prev = editor.getAttributes("link").href as string | undefined
              const url = window.prompt("URL", prev ?? "https://")
              if (url === null) return
              if (url === "") {
                editor.chain().focus().unsetLink().run()
              } else {
                editor.chain().focus().setLink({ href: url }).run()
              }
            }}
            className={editor.isActive("link") ? "is-active" : ""}
            title="Link"
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </button>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} />
    </div>
  )
}
