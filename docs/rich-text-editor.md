# Rich Text Editor

Notion-style WYSIWYG editor built on **Tiptap v3** (MIT). Accepts and emits markdown strings, making it a drop-in replacement for `<Textarea>` wherever the content feeds an LLM or needs markdown persistence.

## Files

| File | Purpose |
|------|---------|
| `src/components/shared/RichTextEditor.tsx` | Main editor component |
| `src/components/shared/SlashCommandMenu.tsx` | Slash command popup + command definitions |
| `src/components/shared/rich-text-editor.css` | ProseMirror styles (OKLCH-compatible, dark mode) |

## Usage

```tsx
<RichTextEditor
  value={markdown}          // controlled markdown string
  onChange={setMarkdown}    // called on every edit
  onCmdEnter={handleSubmit} // Cmd/Ctrl+Enter shortcut
  placeholder="..."
  disabled={false}
  autofocus={false}
  className="min-h-[200px]"
/>
```

`value` / `onChange` round-trip as markdown. The editor re-parses `value` when it changes externally (e.g. loading a template) without resetting the cursor on normal typing, using a `lastEmittedRef` guard.

## Extensions

| Extension | Source | Behaviour |
|-----------|--------|-----------|
| `StarterKit` | `@tiptap/starter-kit` | All base blocks + markdown input rules |
| `Placeholder` | `@tiptap/extension-placeholder` | Grey hint text |
| `TaskList` + `TaskItem` | `@tiptap/extension-task-list/item` | `[ ]` checkboxes, nestable |
| `CodeBlockLowlight` | `@tiptap/extension-code-block-lowlight` | Syntax-highlighted code blocks via `lowlight` |
| `Link` | `@tiptap/extension-link` | Clickable hyperlinks |
| `Markdown` | `tiptap-markdown` | Markdown import (`setContent`) and export (`getMarkdown()`) |
| `SlashCommand` | custom (`@tiptap/suggestion`) | `/` command menu |

## Markdown Input Rules (StarterKit)

Type these at the start of a line to convert automatically:

| Input | Result |
|-------|--------|
| `# ` | Heading 1 |
| `## ` | Heading 2 |
| `### ` | Heading 3 |
| `- ` or `* ` | Bullet list |
| `1. ` | Ordered list |
| `[ ] ` | Task item |
| `> ` | Blockquote |
| ` ``` ` | Code block |
| `---` | Horizontal rule |

Inline: `**bold**`, `_italic_`, `` `code` ``.

## Slash Command Menu

Type `/` to open the menu. Filter by typing after the slash. Navigate with Arrow keys, confirm with Enter, dismiss with Escape.

Available commands: Heading 1–3, Bullet List, Numbered List, Task List, Code Block, Quote, Divider.

Implemented via a custom Tiptap extension wrapping `@tiptap/suggestion`. The popup is rendered via `ReactRenderer` + `document.body.appendChild`, positioned with `position: fixed` relative to the cursor's bounding rect.

## Bubble Menu

Appears on text selection. Buttons: Bold, Italic, Strikethrough, Code, Link (uses `window.prompt` for URL — see TODO for inline popover upgrade).

Imported from `@tiptap/react/menus` (moved out of the main `@tiptap/react` barrel in v3).

## Styling Notes

- CSS variables use OKLCH (`--primary`, `--muted`, `--border`, etc.) — do **not** wrap them in `hsl()`.
- Selection highlight: `color-mix(in oklch, var(--primary) 30%, transparent)` — required because `--primary` is a full `oklch(...)` value, not raw channel numbers.
- The `::selection` rule targets both `.ProseMirror::selection` and `.ProseMirror *::selection` to cover all descendant text nodes.

## Ancestor Scroll Suppression

ProseMirror's default `scrollRectIntoView` implementation walks **all** ancestor scroll containers and adjusts their `scrollLeft`/`scrollTop` whenever the editor wants to scroll the selection into view. This is triggered by `tr.scrollIntoView()`, which TipTap calls internally during `setContent` (e.g. when the `value` prop changes as a session panel loads in).

In the panel group layout, this caused the outer `overflow-x-auto` container to jump horizontally to reveal the session panel whenever content loaded.

Fix: `editorProps.handleScrollToSelection` is set to `() => true`. Returning `true` tells ProseMirror that the host has handled scrolling — suppressing the ancestor walk entirely. Native browser behavior handles cursor-within-editor visibility.

```tsx
editorProps: {
  handleScrollToSelection: () => true,
},
```

## Current Integrations

- **NewSessionPanel** — prompt composer for new Claude agent sessions. Pre-fills from email subject or task metadata. Cmd+Enter starts the session. Templates save/load as markdown strings.

## Planned Integrations

- **TaskDetail** — inline editing of Notion task body with write-back to Notion API
- **Email draft composer** — replacing the plain-text draft creation flow
