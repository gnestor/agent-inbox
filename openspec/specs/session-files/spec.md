# Session Files

## Purpose

Per-session filesystem layout for files exchanged with the agent: `${workspacePath}/sessions/{sessionId}/input/` for user uploads and `${workspacePath}/sessions/{sessionId}/output/` for agent writes. Helpers to validate/sanitise paths, save uploads, look up files for download, list contents, and build a manifest string the session-instruction layer prepends to the system prompt so the agent knows what files exist.

## Context

### Why files live on the filesystem, not the database
The agent reads/writes files with normal POSIX tools (Read/Write/Bash). Storing uploads in the DB and materialising them to disk on every agent turn would either double-write every byte or require a custom FS shim in the agent — both worse than just letting the agent see the real path. The DB persists session metadata; the filesystem persists session payloads.

### Why `input/` and `output/` are split
Agent-written files (artifacts, generated reports) shouldn't collide with user-uploaded inputs of the same name. The split also lets the upload route bind to `input/` while the agent's `/mnt/user-data/outputs/<name>` convention maps to `output/` — symmetric and predictable. The download lookup checks both folders so the API consumer doesn't need to know which side wrote a given filename.

### Why session IDs are validated, not just `path.join`'d
A `sessionId` of `../../etc` would `join` to outside the workspace root. Restricting to `[a-zA-Z0-9_-]+` rejects every `..`, `/`, and shell metacharacter at the boundary — defence in depth on top of `join`'s already-safe semantics. The Claude SDK happens to use UUIDs, but we don't depend on that format.

### Why filenames are sanitised, not rejected
Browsers upload arbitrary filenames including spaces, parens, emoji, and worse. Rejecting would force a UI for renaming; sanitising (`[^a-zA-Z0-9._\- ]` → `_`) preserves the user's intent for the readable parts and silently neutralises the rest. The agent sees the sanitised name in the manifest and uses that exactly when reading the file.

### Why `buildFileManifest` is plain text
The manifest is concatenated into the system prompt — a token-counted resource. JSON or XML would burn tokens on syntax. A bullet list (`- name (subfolder/, size bytes)`) is the smallest unambiguous format, and the agent has been trained to read bullet lists fluently.

### What is NOT in scope
- The HTTP routes that call these helpers (`POST /api/sessions/:id/files`, `GET /api/sessions/:id/files/:name`) → `session-views-controller` spec.
- The agent's view of the files (system prompt assembly, file path conventions) → `session-instructions` spec.
- Render-time file referencing in artifacts (`/mnt/user-data/outputs/<name>`) → `artifacts-and-render-tools` spec.
- Workspace path resolution itself → `workspace` spec.

## Requirements

### Path layout

#### Scenario: Sessions root is `${workspacePath}/sessions/`
- **WHEN** any helper is called with a workspace path
- **THEN** the root is `join(workspacePath || process.cwd(), "sessions")` — a missing/empty workspace path falls back to the process CWD.
- **AND** per-session directories are `<root>/<sessionId>/input/` and `<root>/<sessionId>/output/`.

#### Scenario: Subfolder is exactly `"input" | "output"`
- **WHEN** `getSessionFilesDir` is called
- **THEN** the `subfolder` parameter is typed as the literal union and defaults to `"input"`.
- **AND** the directory is created (`mkdirSync({ recursive: true })`) on first access — callers don't have to pre-create.

### Validation and sanitisation

#### Scenario: Session IDs must match `^[a-zA-Z0-9_-]+$`
- **WHEN** any helper receives a `sessionId`
- **THEN** `validateSessionId` throws `Invalid session ID: ${sessionId}` for any value containing characters outside the allowlist (including `.`, `/`, `\`, spaces).
- **WHY:** prevents path traversal (`../`) and shell-metacharacter injection at the boundary.

#### Scenario: Filenames are coerced to a safe alphabet
- **WHEN** `saveSessionFile` or `getSessionFilePath` receives a filename
- **THEN** every character outside `[a-zA-Z0-9._\- ]` is replaced with `_`.
- **AND** the sanitised name is what's written to disk and what the API returns to the caller — there is no separate "display name" channel.

### Save / look-up / list

#### Scenario: `saveSessionFile` writes to `input/` and returns metadata
- **WHEN** the upload route invokes `saveSessionFile(workspacePath, sessionId, filename, buffer, mimeType?)`
- **THEN** the file is written to `input/<sanitised>` and the helper returns `{ name, path, size, mimeType }` where `mimeType` defaults to `application/octet-stream`.

#### Scenario: `getSessionFilePath` searches `input/` then `output/`
- **WHEN** the download route invokes `getSessionFilePath(workspacePath, sessionId, filename)`
- **THEN** the helper checks `input/<sanitised>` first, then `output/<sanitised>`, returning the first existing path or `null`.
- **WHY:** the caller doesn't know whether the user uploaded it or the agent wrote it — both are addressable by the same name.

#### Scenario: `listSessionFiles` enumerates both folders, tolerating missing dirs
- **WHEN** the route invokes `listSessionFiles(workspacePath, sessionId)`
- **THEN** the result is an array of `{ name, size, subfolder }` for every file under `input/` and `output/`.
- **AND** if either subfolder doesn't exist (no uploads yet, no agent output yet) it is skipped — no empty-directory errors.
- **AND** files that fail `statSync` (e.g. broken symlink) are silently skipped.

### File manifest for system prompt

#### Scenario: Empty manifest when no files exist
- **WHEN** `buildFileManifest` runs against a session with no files
- **THEN** the helper returns `""` so the system prompt isn't padded with an empty section.

#### Scenario: Bullet list with subfolder and byte size
- **WHEN** files exist
- **THEN** the manifest is:
  ```
  \nSession files:\n- name1 (input/, 1234 bytes)\n- name2 (output/, 5678 bytes)\n
  ```
- **AND** files appear in the order returned by `listSessionFiles` (input first, then output, each in `readdirSync` order).

## Technical Notes

| Concern | Location |
|---|---|
| Path layout, validation, sanitisation, save/lookup/list, manifest builder | [server/lib/session-files.ts](../../../server/lib/session-files.ts) |
| HTTP consumers (upload + download routes) | `server/routes/sessions.ts` |
| Tests covering upload/list/download against the helpers | `server/routes/__tests__/sessions.test.ts` |
| `<FileAttachmentBar>` composer attachment chips + drag overlay | [src/components/session/FileAttachmentBar.tsx](../../../src/components/session/FileAttachmentBar.tsx) |
| Pending-file state hook (drag/drop, upload reducer) | [src/hooks/use-file-attachments.ts](../../../src/hooks/use-file-attachments.ts) |

## History

- The directory layout was originally flat (`sessions/<id>/<file>`); split into `input/`/`output/` after agent-written reports overwrote a user upload of the same name in a debugging session.
- `validateSessionId` was added after a prototype accepted `..` in the path, exposing the workspace root above `sessions/` to read.
- `buildFileManifest` was JSON early on; rewritten to bullet text after a token-budget review showed ~25% of system-prompt tokens for sessions with many files were JSON syntax.
