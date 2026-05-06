# Rich Text Editor

## Purpose

A controlled `<RichTextEditor>` component used by the session composer and Gmail draft surface. Backed by TipTap with markdown round-tripping, slash-command menu, code blocks (highlighted via lowlight), task lists, and a `Cmd-Enter` submit hook. Owns its own stylesheet and slash-menu component.

## Context

### Why TipTap, not contenteditable + custom serializer
We need rich block types (headings, lists, task items, code blocks) and a slash-command UX. TipTap's ProseMirror schema gives that for free, plus stable cursor handling on external content swaps. Building this on raw `contenteditable` would replicate ProseMirror badly.

### Why markdown is the wire format
Parents (composer state, drafts persistence, agent SDK input) all want strings. Markdown round-trips cleanly through TipTap via `tiptap-markdown` and can be diffed/displayed without rehydrating an editor. The exception is Gmail drafts, which arrive as HTML — the editor sniffs `<` and uses `generateJSON()` to parse HTML into ProseMirror nodes once on mount, then re-emits markdown.

### Why `handleScrollToSelection` is overridden
ProseMirror's default selection-scroll walks every ancestor and scrolls each — including the outer panel group, causing horizontal jumps when the editor loads inside a sliding-in panel. Returning `true` from `handleScrollToSelection` no-ops the walk; the browser's native cursor visibility behavior is enough inside the editor element.

### Why slash commands live in this domain, not the composer
The slash menu is generic (heading levels, lists, code, task lists) and reusable. Per-feature commands (e.g. attaching a file) belong in the consumer, not in `SLASH_COMMANDS`.

## Requirements

### Controlled markdown surface

#### Scenario: Parent passes markdown, editor emits markdown
- **WHEN** `<RichTextEditor value={md} onChange={setMd} />` is rendered
- **THEN** the editor initializes from the markdown string (or HTML if the string starts with `<`).
- **AND** every keystroke triggers `onChange(<markdown>)` via the `tiptap-markdown` storage `getMarkdown()`.

#### Scenario: External value updates re-sync without losing cursor
- **WHEN** the parent passes a new `value` that differs from the last emitted markdown
- **THEN** the editor calls `setContent(...)` with `emitUpdate: false` and re-emits the markdown so parent state stays canonical.
- **AND** when the new value starts with `<`, the editor parses it via `generateJSON()` rather than treating tags as literal markdown.
- **WHY:** Gmail drafts arrive as HTML; double-encoding them through markdown would corrupt formatting.

#### Scenario: Initial value comparison short-circuits
- **WHEN** the new `value` equals `lastEmittedRef.current`
- **THEN** the sync effect is a no-op so the cursor is preserved on benign re-renders.

### Slash command menu

#### Scenario: `/` opens the suggestion menu
- **WHEN** the user types `/` in any block
- **THEN** the TipTap `Suggestion` plugin renders `<SlashCommandMenu>` with entries from `SLASH_COMMANDS`.
- **AND** selecting an entry calls its `command({ editor, range })`, which deletes the typed `/` range and applies the block transform.

#### Scenario: Built-in commands cover headings, lists, code, tasks
- **WHEN** the menu is open
- **THEN** entries include Heading 1/2/3, Bullet List, Numbered List, Task List, Code Block.

### Submit shortcut

#### Scenario: `Cmd-Enter` (or `Ctrl-Enter`) calls the parent
- **WHEN** the user presses `Mod-Enter`
- **THEN** the editor calls `onCmdEnter?.()` and the keypress is consumed (returns `true`).
- **AND** the latest `onCmdEnter` reference is held in a ref so the keyboard shortcut always sees the freshest closure without remounting the editor.

### Selection scroll override

#### Scenario: Editor never scrolls outer ancestors on selection change
- **WHEN** ProseMirror would walk ancestor scroll containers to bring the selection into view
- **THEN** `handleScrollToSelection` returns `true`, suppressing the walk.
- **WHY:** the outer panel group has `overflow-x-auto`; the default behavior caused horizontal jumps when the editor mounted inside a sliding-in panel.

### Disabled / placeholder / autofocus

#### Scenario: Disabled editor is not editable
- **WHEN** `disabled` prop is true
- **THEN** TipTap's `editable: false` is applied.

#### Scenario: Placeholder shows when empty
- **WHEN** the document has no content
- **THEN** the `Placeholder` extension renders the `placeholder` prop (default `"Start typing..."`).

#### Scenario: Autofocus targets end of doc
- **WHEN** `autofocus` is true
- **THEN** TipTap focuses with `"end"` so the cursor lands after any seeded content.

## Technical Notes

| Concern | Location |
|---|---|
| `<RichTextEditor>` props, extensions, controlled markdown round-trip | [src/components/shared/RichTextEditor.tsx](../../../src/components/shared/RichTextEditor.tsx) |
| `Cmd-Enter` keymap and slash extension factory | [src/components/shared/RichTextEditor.tsx:21-103](../../../src/components/shared/RichTextEditor.tsx#L21-L103) |
| Slash menu component and `SLASH_COMMANDS` registry | [src/components/shared/SlashCommandMenu.tsx](../../../src/components/shared/SlashCommandMenu.tsx) |
| Editor stylesheet (prose tweaks, code blocks, placeholder) | [src/components/shared/rich-text-editor.css](../../../src/components/shared/rich-text-editor.css) |

## History

- HTML detection on initial value added when Gmail drafts started rendering as escaped tags inside the editor.
- `handleScrollToSelection` override added after the panel group jumped horizontally every time a session resumed and the editor reloaded a draft.
- Slash command moved out of an inline extension into its own file so it could be tested and extended without touching the editor's effect chain.
