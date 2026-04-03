# File Upload Input — Implementation 1

## Progress

- [x] 2026-04-02 10:00 — Setup: read CLAUDE.md, created branch, installed deps
- [x] 2026-04-02 10:05 — Read target files, understood existing patterns
  - Backend file upload infra complete: `saveSessionFile()`, `POST /:id/files`, `uploadSessionFile()` API client
  - NewSessionPanel uses RichTextEditor (TipTap), SessionView uses plain Textarea
  - `createSession()` returns sessionId, then files can be uploaded to that session
  - `resumeSession()` sends plain text prompt
- [ ] Create useFileAttachments hook
- [ ] Create FileAttachmentBar component
- [ ] Wire up SessionView (follow-up input)
- [ ] Wire up NewSessionPanel (compose input)
- [ ] Write tests
- [ ] Typecheck and test

## Acceptance Criteria

- [ ] I can drag an image file onto the new session input and see it appear as an attachment chip below the textarea
- [ ] I can paste an image from my clipboard into either input and see it as an attachment chip
- [ ] I can click a paperclip/attach button to browse and select files
- [ ] I can remove a pending attachment before sending by clicking the X on the chip
- [ ] When I send a message with attachments, the files are uploaded and the agent can read them
- [ ] The attachment UI works in both the new session ComposePanel and the SessionView follow-up input
- [ ] Large files (>10MB) show an error message instead of being attached
- [ ] Supported image types (PNG, JPG, GIF, WebP) show a thumbnail preview in the chip

## Summary

**Status:** In Progress
