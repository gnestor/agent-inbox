import { useEffect, useMemo, useRef } from "react"
import { EditorContent, ReactRenderer, useEditor } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import { TaskList } from "@tiptap/extension-task-list"
import { TaskItem } from "@tiptap/extension-task-item"
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import { TableKit } from "@tiptap/extension-table/kit"
import { Extension, type Editor } from "@tiptap/core"
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion"
import { Markdown } from "tiptap-markdown"
import { common, createLowlight } from "lowlight"
import { Bold, Italic, Strikethrough, Code, Link as LinkIcon } from "lucide-react"
import {
  SlashCommandMenu,
  SLASH_COMMANDS,
  type SlashCommandItem,
  type SlashCommandMenuHandle,
  type SlashCommandMenuProps,
} from "./SlashCommandMenu"
import "./rich-text-editor.css"

const lowlight = createLowlight(common)

function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown
  if (storage === null || typeof storage !== "object" || Array.isArray(storage)) {
    throw new Error("TipTap markdown storage is unavailable")
  }
  const markdown = Reflect.get(storage, "markdown") as unknown
  if (markdown === null || typeof markdown !== "object" || Array.isArray(markdown)) {
    throw new Error("TipTap markdown extension is unavailable")
  }
  const getter = Reflect.get(markdown, "getMarkdown") as unknown
  if (typeof getter !== "function") throw new Error("TipTap markdown serializer is unavailable")
  const value = Reflect.apply(getter, markdown, []) as unknown
  if (typeof value !== "string") throw new Error("TipTap markdown serializer returned a non-string value")
  return value
}

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
        Suggestion<SlashCommandItem, SlashCommandItem>({
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
            let component: ReactRenderer<SlashCommandMenuHandle, SlashCommandMenuProps>
            return {
              onStart: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => {
                component = new ReactRenderer(SlashCommandMenu, {
                  props: {
                    items: props.items,
                    command: (item: SlashCommandItem) => {
                      props.command(item)
                    },
                    clientRect: props.clientRect ?? null,
                  },
                  editor: props.editor,
                })
                document.body.appendChild(component.element)
              },
              onUpdate: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => {
                component.updateProps({
                  items: props.items,
                  command: (item: SlashCommandItem) => {
                    props.command(item)
                  },
                  clientRect: props.clientRect ?? null,
                })
              },
              onKeyDown: (props: SuggestionKeyDownProps) => {
                if (props.event.key === "Escape") {
                  component.destroy()
                  component.element.remove()
                  return true
                }
                return component.ref?.onKeyDown(props.event) ?? false
              },
              onExit: () => {
                component.element.remove()
                component.destroy()
              },
            }
          },
          command: ({ editor, range, props }) => {
            props.command({ editor, range })
          },
        }),
      ]
    },
  })
}

// ── RichTextEditor ────────────────────────────────────────────────────────────

/**
 * Markdown-in / markdown-out rich-text editor (TipTap). The parent owns a
 * markdown string; the editor renders it as a WYSIWYG ProseMirror doc and
 * emits markdown on every change.
 *
 * This is Inbox's richer variant — slash commands, task lists, and
 * lowlight-highlighted code blocks, on top of the marks StarterKit provides.
 * The lean editor without them lives in Studio.
 *
 * Markdown is the only accepted value — markup in the value stays literal
 * text. The editor used to sniff for a leading `<` and parse the value as
 * HTML, which could never fire: `parseMessage` (plugins/gmail/app/lib/gmail.ts)
 * runs every HTML body through `htmlToMarkdown` before it reaches the client,
 * and the session composers are seeded from markdown the user typed. That dead
 * branch was not free — it made a table lost server-side, in a converter with
 * no table rules, look like an editor bug. If HTML ever reaches this prop, the
 * converter upstream is what to fix.
 */
interface RichTextEditorProps {
  /** Current value, as markdown. */
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
      StarterKit.configure({ codeBlock: false, link: { openOnClick: false } }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight }),
      // Table nodes so an incoming GFM markdown table round-trips. Without
      // them tiptap-markdown has nowhere to put the rows and concatenates
      // every cell into one paragraph — "NDCDueNov 1010/27" — which is worse
      // than the flattening the converter's table rules just stopped.
      TableKit.configure({ table: { resizable: false } }),
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

  // Seeded once; later changes arrive through the sync effect below, which
  // knows not to clobber in-progress typing.
  const initialValue = useRef(value).current

  const editor = useEditor({
    extensions,
    content: initialValue,
    editable: !disabled,
    autofocus: autofocus ? "end" : false,
    editorProps: {
      // Suppress ProseMirror's automatic scroll-into-view. Its default implementation
      // walks ALL ancestor scroll containers and scrolls each one, which causes the
      // outer overflow-x-auto panel group to jump horizontally when content loads
      // (e.g. when setContent is called as the panel slides in). Native browser
      // behavior handles cursor visibility within the editor.
      handleScrollToSelection: () => true,
      attributes: {
        class: "prose prose-sm max-w-none dark:prose-invert",
      },
    },
    onUpdate: ({ editor }) => {
      const md = getMarkdown(editor)
      lastEmittedRef.current = md
      onChange(md)
    },
  })

  // Sync external value changes (loading a template, seeding a Gmail draft)
  // without clobbering in-progress typing.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (value === lastEmittedRef.current) return
    lastEmittedRef.current = value
    editor.commands.setContent(value, { emitUpdate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value])

  // Sync disabled
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!disabled)
  }, [editor, disabled])

  return (
    <div
      className={`relative rounded-md border-input ring-offset-background ${disabled ? "opacity-50 pointer-events-none" : ""} ${className}`}
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
              const attributes = editor.getAttributes("link") as unknown
              const prev =
                attributes !== null &&
                typeof attributes === "object" &&
                !Array.isArray(attributes) &&
                typeof Reflect.get(attributes, "href") === "string"
                  ? Reflect.get(attributes, "href") as string
                  : undefined
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
