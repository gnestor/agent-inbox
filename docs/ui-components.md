# UI Components

This doc owns shared UI component conventions that are not specific to sessions, plugins, navigation, or settings.

## Context

Inbox is an operational tool. The UI should be compact, predictable, and easy to scan during repeated use. Shared components are where visual and interaction consistency either compounds or degrades.

## Spec

### Component Rules

- Prefer shared components in `src/components/shared/` for repeated list, detail, empty, loading, filter, and editor patterns.
- Keep cards to repeated items, modals, and genuinely framed tools.
- Keep panel text compact: `text-sm` for primary/body text and `text-xs` for secondary/status text.
- Use icon buttons for common commands when a clear icon exists.
- Do not embed transport or persistence details in shared components.
- Expose controlled props and callbacks rather than reaching into stores directly.
- Loading, empty, and error states should be first-class states, not afterthought branches.

### Editor Surfaces

Rich text editor behavior is owned by [`rich-text-editor.md`](rich-text-editor.md). This doc owns how shared editor components fit into the broader UI conventions.

## History

| Date | Commit | Change |
|------|--------|--------|
| 2026-04-29 | `5e413d6` | Added shared UI component ownership spec. |
