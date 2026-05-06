# Workspace

## Purpose

Register the directory paths that the inbox can act in, persist them in Postgres, gate every authenticated request to a single active workspace, and manage per-workspace membership/roles. A workspace is the unit of: filesystem scope (where Agent SDK sessions run), credential scope (workspace-level vault entries), source scope (which plugins' context files live where), and access control (who can see what).

## Context

### One workspace per CLI invocation, many over time
The server is launched with `--workspace <path>` (or repeated, defaulting to `../agent`). On boot `registerWorkspaces(paths)` reconciles the DB to that exact list — workspaces present in the DB but not in the boot args are deleted along with their `workspace_members` rows. The DB is the long-lived registry; the CLI args are the source of truth for *which subset is currently mounted*.

### Workspace ID = directory basename
The `workspaces.id` column is `basename(path)`. This is intentional, not an oversight: the same directory mounted at a different path keeps its identity, sessions/credentials/members keyed by ID stay valid, and the ID is human-readable in logs. Two workspaces with colliding basenames cannot be registered simultaneously — `path` has a UNIQUE constraint that surfaces the collision at register time.

### Auto-claim policy
A workspace with zero members is "unclaimed" and the first authenticated user to touch it becomes admin. `claimUnclaimedWorkspaces(email)` runs on every active-workspace resolution but is gated by an in-process `claimedUsers: Set<string>` so it only runs once per user per process lifetime. The cache is cleared on `registerWorkspaces` (new workspaces may need claiming) and exposed via `resetClaimCache()`.

This makes a fresh deploy boot into a working state without manual SQL: the user signs in, hits any `/api/*` route, and the auth middleware's `resolveActiveWorkspace` call claims them as admin of every unclaimed workspace.

### Why admin checks live in `requireAdmin`, not middleware
Some routes (`/api/workspaces` list, `/api/workspaces/active`) need only membership, not admin. A blanket admin middleware would break the list view. The pattern is: auth middleware sets `c.var.workspace` with `role`; route handlers call `requireAdmin(c)` when they need admin authority. The function throws `HTTPException(403)` so it composes cleanly with Hono's error handler.

### Why `isLastAdmin` is a separate guard
Demoting or removing the last admin would orphan the workspace. Both `DELETE /:id/members/:email` and `PATCH /:id/members/:email` (when role becomes `member`) call `isLastAdmin` first and return 400 if true. The check counts admins **excluding the user being changed** — the row in question may or may not still exist when the check runs, so the count must be over "other admins."

## Requirements

### Workspace registration

#### Scenario: Boot upserts and reconciles
- **WHEN** the server starts and calls `registerWorkspaces(paths)`
- **THEN** for each path, `(id = basename(path), name = deriveWorkspaceName(path), path)` is upserted into `workspaces` with `ON CONFLICT(id) DO UPDATE SET path, updated_at`.
- **AND** any `workspaces` row whose `id` is NOT in the current paths is deleted, along with its `workspace_members` rows (in that order to satisfy the FK).
- **AND** the in-process `claimedUsers` cache is cleared.

#### Scenario: Empty registration list is a no-op for cleanup
- **WHEN** `registerWorkspaces([])` is called
- **THEN** the cleanup DELETE statements are skipped (placeholder list would be empty SQL).
- **AND** existing rows remain untouched.
- **WHY:** prevents an accidental boot with no `--workspace` arg from wiping the registry.

#### Scenario: Display name comes from git remote, falls back to basename
- **WHEN** `deriveWorkspaceName(path)` runs against a directory with `git remote get-url origin` succeeding
- **THEN** the name is the URL's last path segment with `.git` stripped (e.g. `agent-inbox` from `git@github.com:gnestor/agent-inbox.git`).
- **WHEN** the directory is not a git repo OR has no `origin` remote
- **THEN** the name falls back to `basename(path)`.

### Membership & roles

#### Scenario: First user auto-claims as admin
- **WHEN** `ensureWorkspaceAccess(workspaceId, email)` runs and the workspace has zero members
- **THEN** the user is inserted into `workspace_members` with role `"admin"`.
- **AND** an info log records `"Auto-assigned admin role"`.

#### Scenario: Existing member returns their role
- **WHEN** the user already has a row in `workspace_members`
- **THEN** their existing role is returned without modification.

#### Scenario: Non-member of a claimed workspace gets null
- **WHEN** the workspace has ≥1 member AND the user is not one of them
- **THEN** `ensureWorkspaceAccess` returns `null` (no auto-grant).

#### Scenario: `addWorkspaceMember` is idempotent
- **WHEN** called for a user already in the workspace
- **THEN** `ON CONFLICT DO NOTHING` makes it a no-op — no error, no role change.

#### Scenario: Cannot remove the last admin
- **WHEN** `DELETE /api/workspaces/:id/members/:email` is called and `isLastAdmin(id, email)` returns true
- **THEN** the response is 400 `{ error: "Cannot remove the last admin" }`.

#### Scenario: Cannot demote the last admin
- **WHEN** `PATCH /api/workspaces/:id/members/:email` is called with `{ role: "member" }` and `isLastAdmin(id, email)` returns true
- **THEN** the response is 400 `{ error: "Cannot demote the last admin" }`.

### Active workspace resolution

#### Scenario: Cookie-based active workspace
- **WHEN** `resolveActiveWorkspace(email, cookieWorkspaceId)` runs and the cookie names a workspace the user is a member of
- **THEN** that workspace + role is returned.

#### Scenario: Falls back to first user workspace
- **WHEN** the cookie is missing OR names a workspace the user has no membership in
- **THEN** the user's first workspace (alphabetical by name from `getUserWorkspaces`) is returned.

#### Scenario: User with no memberships returns null
- **WHEN** the user is a member of zero workspaces (after claim pass)
- **THEN** `resolveActiveWorkspace` returns `null` and the auth middleware does NOT set `c.var.workspace`.
- **AND** routes that call `c.get("workspace")` will see `undefined` and must handle it (the connections list, for example, falls back to `getWorkspaceName()`).

#### Scenario: Active-workspace cookie lifetime
- **WHEN** `PUT /api/workspaces/active` sets the cookie
- **THEN** `inbox_workspace` is set with `httpOnly: true`, `sameSite: "Lax"`, `path: "/"`, `maxAge: 1 year`.
- **AND** `secure` is NOT explicitly set (inherits the default — same as the dev/prod split is not strictly needed since the value is a workspace ID, not a credential).

### REST API

#### Scenario: `GET /api/workspaces`
- **WHEN** the authenticated user lists their workspaces
- **THEN** the response is `{ workspaces: WorkspaceRow[] with role, activeWorkspaceId }` — `activeWorkspaceId` mirrors `c.var.workspace.id` or null.

#### Scenario: `PUT /api/workspaces/active`
- **WHEN** the request body validates against `SetActiveWorkspaceBody` AND the workspace exists
- **THEN** the cookie is set and the response is `{ id, name }`.
- **WHEN** the workspace does not exist
- **THEN** the response is 404 `{ error: "Workspace not found" }`.
- **NOTE:** this route does NOT verify the user is a member of the target workspace at write-time — the check happens at read-time in `resolveActiveWorkspace`, which falls back to the user's first workspace if they cookie-set themselves into something they cannot access.

#### Scenario: `GET /api/workspaces/:id` (admin only)
- **WHEN** `requireAdmin(c)` passes
- **THEN** the response is `{ workspace, members }` with `members` enriched with `name` and `picture` from `users`.

#### Scenario: `PUT /api/workspaces/:id` (admin only)
- **WHEN** the body validates against `RenameWorkspaceBody`
- **THEN** `name` is trimmed and updated; `updated_at` is bumped.

#### Scenario: `GET /api/workspaces/:id/git` (admin only)
- **WHEN** the workspace exists
- **THEN** the response is `{ branch, remote, remoteUrl, status }` with `branch` from `git branch --show-current`, `remoteUrl` derived as `https://github.com/<owner/repo>` from `origin`, and `status` capped at the first 20 lines of `git status --porcelain`.
- **AND** every git call is best-effort — failures fall back to `null`/`[]` rather than throwing.

#### Scenario: `POST /api/workspaces/:id/members` (admin only)
- **WHEN** the email matches an existing row in `users`
- **THEN** the user is added with the requested role (default `"member"`).
- **WHEN** the email does not match
- **THEN** the response is 404 `{ error: "User not found" }` — members must have signed in at least once.

#### Scenario: `GET /api/workspaces/:id/available-users` (admin only)
- **WHEN** the admin needs to add a member
- **THEN** the response is `{ users }` containing every row in `users` whose email is NOT already in `workspace_members` for the target workspace.

### Admin guard

#### Scenario: `requireAdmin` enforces role
- **WHEN** `c.var.workspace` is unset OR `c.var.workspace.role !== "admin"`
- **THEN** the function throws `HTTPException(403, { message: "Admin access required" })`.

## Technical Notes

| Concern | Location |
|---|---|
| Workspace registry CRUD, member CRUD, role checks | [server/lib/workspace-scanner.ts](../../../server/lib/workspace-scanner.ts) |
| Auto-claim cache + `resolveActiveWorkspace` | [server/lib/workspace-scanner.ts:182-231](../../../server/lib/workspace-scanner.ts#L182-L231) |
| Git info helper (best-effort, capped output) | [server/lib/workspace-scanner.ts:235-264](../../../server/lib/workspace-scanner.ts#L235-L264) |
| `WorkspaceContext` and `AppBindings` types, `requireAdmin` | [server/lib/workspace-context.ts](../../../server/lib/workspace-context.ts) |
| Workspace REST routes | [server/routes/workspaces.ts](../../../server/routes/workspaces.ts) |
| `WORKSPACE_COOKIE = "inbox_workspace"` | [server/routes/workspaces.ts:30](../../../server/routes/workspaces.ts#L30) |
| Active-workspace cookie read in auth middleware | `server/index.ts:280-283` |
| Tables `workspaces`, `workspace_members` | `server/db/migrations/002_workspaces.sql` |
| Validation schemas | `server/lib/schemas.ts` |
| Workspace settings UI (rename, members, git info) | [src/components/workspace/WorkspaceSettings.tsx](../../../src/components/workspace/WorkspaceSettings.tsx) |

## History

- Workspace ID is `basename(path)` so the same directory mounted at different paths keeps a stable identity.
- Auto-claim added so a fresh deploy boots into a working state without manual SQL — the first authenticated user becomes admin of every unclaimed workspace.
- `isLastAdmin` introduced after a regression where demoting the only admin orphaned the workspace; check counts admins **excluding** the user being changed.
- Active-workspace cookie verified at read-time (in `resolveActiveWorkspace`) rather than write-time so a stale cookie pointing at a workspace the user lost access to falls back gracefully instead of 403'ing.
