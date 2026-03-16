# Phase 2.5C: Tab Migrations — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate each tab from the old PanelStack system to the new Tab/Panel/ListView/DetailView components, one tab at a time. After all tabs are migrated, remove PanelStack.

**Architecture:** Each tab gets a `*Tab.tsx` file that wires data fetching → ListView/DetailView → Tab/Panel. The `PanelContent.tsx` placeholder is replaced with actual component mappings. The old PanelStack continues to serve un-migrated tabs during the transition.

**Tech Stack:** React 19, TypeScript, TanStack Query, Framer Motion

**Depends on:** Plan A (navigation core) and Plan B (ListView + DetailView)

**Spec:** `packages/inbox/.plans/phase-2.5-navigation-redesign-spec.md`

---

## Migration Order

1. **Sessions** — simplest (no sub-item sessions, no session-from-detail flow)
2. **Emails** — most complex (session panels, draft compose, linked sessions)
3. **Tasks** — similar to emails but simpler
4. **Calendar** — nearly identical to tasks
5. **Settings** — single panel, already partially migrated
6. **Plugins** — uses existing PluginList/PluginDetail, minimal changes
7. **Wire into App.tsx** — replace PanelStack with NavigationProvider + Tabs
8. **Cleanup** — remove PanelStack, use-spatial-nav, RecentPane

Each migration task follows the same pattern:
1. Create `*Tab.tsx` that renders Tab + Panel + content components
2. Create `*ListView.tsx` using ListView with a fieldSchema
3. Update or simplify `*DetailView.tsx` using DetailView wrapper
4. Register in `PanelContent.tsx`
5. Test in browser
6. Commit

---

## Chunk 1: Sessions Tab + App Wiring

### Task 1: SessionListView

**Files:**
- Create: `src/components/session/SessionListView.tsx`

- [ ] **Step 1: Define session fieldSchema and create SessionListView**

```tsx
// src/components/session/SessionListView.tsx
import { useSessions } from "@/hooks/use-sessions"
import { useNavigation } from "@/hooks/use-navigation"
import { ListView } from "@/components/shared/ListView"
import type { FieldDef } from "@/types/plugin"

const sessionFieldSchema: FieldDef[] = [
  { id: "summary", label: "Title", type: "text", listRole: "title" },
  { id: "updatedAt", label: "Updated", type: "date", listRole: "timestamp" },
  { id: "status", label: "Status", type: "select",
    badge: { show: "always", variant: "outline" },
    filter: { filterable: true, filterOptions: ["running", "complete", "errored"] } },
  { id: "project", label: "Project", type: "text",
    badge: { show: "if-set" },
    filter: { filterable: true } },
  { id: "prompt", label: "Prompt", type: "text", listRole: "hidden" },
]

export function SessionListView() {
  const { selectItem, getSelectedItemId, activeFilters, setFilter } = useNavigation()
  const { sessions, loading, error } = useSessions(
    Object.keys(activeFilters).length > 0 ? activeFilters : undefined
  )

  // Fallback: use prompt as title if summary is empty
  const items = sessions.map((s) => ({
    ...s,
    summary: s.summary || (s.prompt ? s.prompt.slice(0, 60) : "Untitled session"),
  }))

  return (
    <ListView
      title="Sessions"
      items={items}
      loading={loading}
      error={error}
      fieldSchema={sessionFieldSchema}
      getItemId={(s) => s.id}
      selectedId={getSelectedItemId()}
      onSelect={selectItem}
      activeFilters={activeFilters}
      onFilterChange={setFilter}
      onSearch={(q) => setFilter("q", q)}
      searchPlaceholder="Search sessions..."
    />
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/session/SessionListView.tsx
git commit -m "feat: add SessionListView using schema-driven ListView"
```

### Task 2: SessionTab

**Files:**
- Create: `src/components/session/SessionTab.tsx`

- [ ] **Step 1: Create SessionTab**

```tsx
// src/components/session/SessionTab.tsx
import { useNavigation } from "@/hooks/use-navigation"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PanelSlot } from "@/components/navigation/PanelSlot"
import { PanelContent } from "@/components/navigation/PanelContent"
import { SessionListView } from "./SessionListView"
import { SessionView } from "./SessionView"
import { NavigationContext } from "@/components/navigation/NavigationProvider"
import { useContext } from "react"

export function SessionTab() {
  const { getPanels } = useNavigation()
  const ctx = useContext(NavigationContext)
  const panels = getPanels("sessions")

  return (
    <Tab id="sessions">
      {panels.map((panel, index) => {
        // Slot 0 (list) doesn't need item animation
        if (index === 0) {
          return (
            <Panel key="list" id="list" variant="list">
              <SessionListView />
            </Panel>
          )
        }

        // Other slots get PanelSlot for item-change animation
        return (
          <PanelSlot key={index} panelId={panel.id} directionRef={ctx!.itemDirectionRef}>
            <Panel id={panel.id} variant={panel.type}>
              {panel.type === "session" ? (
                <SessionView sessionId={panel.props.sessionId} />
              ) : (
                <PanelContent panel={panel} />
              )}
            </Panel>
          </PanelSlot>
        )
      })}
    </Tab>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/session/SessionTab.tsx
git commit -m "feat: add SessionTab using new navigation components"
```

### Task 3: Update PanelContent to map real components

**Files:**
- Modify: `src/components/navigation/PanelContent.tsx`

- [ ] **Step 1: Add component mappings**

Replace the placeholder with actual component imports. Components that haven't been migrated yet fall back to the placeholder.

```tsx
// src/components/navigation/PanelContent.tsx
import { lazy, Suspense } from "react"
import type { PanelState } from "@/types/navigation"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"

// Lazy-load tab-specific components to avoid circular imports
const SessionView = lazy(() => import("@/components/session/SessionView").then((m) => ({ default: m.SessionView })))
const IntegrationsPage = lazy(() => import("@/components/settings/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })))

interface PanelContentProps {
  panel: PanelState
}

export function PanelContent({ panel }: PanelContentProps) {
  const fallback = <PanelSkeleton />

  switch (panel.type) {
    case "session":
      return (
        <Suspense fallback={fallback}>
          <SessionView sessionId={panel.props.sessionId} />
        </Suspense>
      )

    case "settings":
      return (
        <Suspense fallback={fallback}>
          <IntegrationsPage />
        </Suspense>
      )

    // Placeholder for unmigrated panel types
    default:
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          <div className="text-center">
            <p className="font-medium">{panel.type}</p>
            <p className="text-xs mt-1">{panel.id}</p>
          </div>
        </div>
      )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/navigation/PanelContent.tsx
git commit -m "feat: wire PanelContent to session and settings components"
```

### Task 4: Wire NavigationProvider into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add NavigationProvider and start rendering SessionTab**

This is the key integration point. During migration, both systems coexist:
- Sessions tab: new navigation system
- Other tabs: old PanelStack

Wrap the app in `NavigationProvider`. Add `SessionTab` alongside PanelStack routes:

```tsx
// In App.tsx, add import:
import { NavigationProvider } from "@/components/navigation"
import { SessionTab } from "@/components/session/SessionTab"

// Wrap AuthenticatedApp content:
function AuthenticatedApp() {
  const isMobile = useIsMobile()
  return (
    <NavigationProvider>
      <SpatialNavProvider isMobile={isMobile}>
        <SidebarProvider>
          <LiquidGlassFilter />
          <AppSidebar />
          <SidebarInset className="max-h-svh overflow-hidden">
            <div className="flex flex-1 h-full">
              <Routes>
                <Route path="/" element={<Navigate to={getSavedPathname()} replace />} />
                <Route path="/plugins/:id/*" element={<PluginView />} />
                <Route path="/*" element={<PanelStack />} />
              </Routes>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </SpatialNavProvider>
    </NavigationProvider>
  )
}
```

> **Note:** The initial wiring keeps PanelStack as the catch-all. SessionTab will be integrated once we verify the navigation core works end-to-end. The full switchover (replacing PanelStack with Tab-based routing) happens after all tabs are migrated.

- [ ] **Step 2: Verify app still works**

Run both servers, navigate to all tabs, verify no regressions.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add NavigationProvider wrapper to App (coexists with PanelStack)"
```

---

## Chunk 2: Email Tab Migration

### Task 5: EmailListView

**Files:**
- Create: `src/components/email/EmailListView.tsx`

- [ ] **Step 1: Define email fieldSchema and create EmailListView**

```tsx
// src/components/email/EmailListView.tsx
import { useNavigation } from "@/hooks/use-navigation"
import { ListView } from "@/components/shared/ListView"
import { useEmails } from "@/hooks/use-emails"
import type { FieldDef } from "@/types/plugin"

export const emailFieldSchema: FieldDef[] = [
  { id: "from", label: "From", type: "text", listRole: "title" },
  { id: "subject", label: "Subject", type: "text", listRole: "subtitle" },
  { id: "date", label: "Date", type: "date", listRole: "timestamp" },
  { id: "isUnread", label: "Unread", type: "boolean",
    badge: { show: "if-set", variant: "default" } },
  { id: "isImportant", label: "Important", type: "boolean",
    badge: { show: "if-set", colorFn: () => "text-yellow-600 bg-yellow-600/10" } },
  { id: "isStarred", label: "Starred", type: "boolean",
    badge: { show: "if-set", colorFn: () => "text-yellow-500 bg-yellow-500/10" } },
  { id: "labels", label: "Labels", type: "multiselect",
    badge: { show: "if-set", variant: "secondary" },
    filter: { filterable: true } },
  { id: "body", label: "Body", type: "html", listRole: "hidden" },
]

export function EmailListView() {
  const { selectItem, getSelectedItemId, activeFilters, setFilter } = useNavigation()
  const { threads, loading, error, hasMore, loadMore } = useEmails(activeFilters)

  return (
    <ListView
      title="Emails"
      items={threads ?? []}
      loading={loading}
      error={error}
      fieldSchema={emailFieldSchema}
      getItemId={(t) => t.threadId}
      selectedId={getSelectedItemId()}
      onSelect={selectItem}
      activeFilters={activeFilters}
      onFilterChange={setFilter}
      hasMore={hasMore}
      loadMore={loadMore}
      searchPlaceholder="Search emails..."
      onSearch={(q) => setFilter("q", q)}
    />
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/email/EmailListView.tsx
git commit -m "feat: add EmailListView using schema-driven ListView"
```

### Task 6: EmailDetailView

**Files:**
- Create: `src/components/email/EmailDetailView.tsx`

- [ ] **Step 1: Create EmailDetailView**

This uses DetailView with custom `children` since email threads have complex rendering (HTML iframe, reply composer, etc.):

```tsx
// src/components/email/EmailDetailView.tsx
import { useQuery } from "@tanstack/react-query"
import { useNavigation } from "@/hooks/use-navigation"
import { DetailView } from "@/components/shared/DetailView"
import { getEmailThread } from "@/api/client"
import { SessionActionMenu } from "@/components/session/AttachToSessionMenu"
// Import existing email content rendering (preserved from EmailThread.tsx)
// This will reference the existing EmailThread content — the header/loading/error
// boilerplate is now handled by DetailView

interface EmailDetailViewProps {
  itemId: string
  title?: string
}

export function EmailDetailView({ itemId, title }: EmailDetailViewProps) {
  const { data: thread, isLoading, error } = useQuery({
    queryKey: ["email-thread", itemId],
    queryFn: () => getEmailThread(itemId),
  })
  const { openSession, deselectItem } = useNavigation()

  return (
    <DetailView
      title={title || thread?.subject || "Email"}
      loading={isLoading}
      error={error?.message}
      onBack={deselectItem}
      headerRight={
        thread ? (
          <SessionActionMenu
            source={{
              type: "email",
              id: itemId,
              title: thread.subject,
              content: `Email thread: ${thread.subject}`,
            }}
            newSessionPath={`/emails/${itemId}/session/new`}
            hasLinkedSession={false}
          />
        ) : undefined
      }
    >
      {/* Email content rendering goes here — extracted from existing EmailThread.tsx */}
      {thread && <div>Email content placeholder — wire existing EmailThread content</div>}
    </DetailView>
  )
}
```

> **Note:** The actual email content rendering (HTML iframe, message cards, draft composer) stays in the existing EmailThread component. EmailDetailView wraps it with the standard DetailView shell. The full content migration is a separate task within this chunk.

- [ ] **Step 2: Commit**

```bash
git add src/components/email/EmailDetailView.tsx
git commit -m "feat: add EmailDetailView using DetailView wrapper"
```

### Task 7: EmailTab

**Files:**
- Create: `src/components/email/EmailTab.tsx`

- [ ] **Step 1: Create EmailTab**

```tsx
// src/components/email/EmailTab.tsx
import { useContext } from "react"
import { useNavigation } from "@/hooks/use-navigation"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PanelSlot } from "@/components/navigation/PanelSlot"
import { PanelContent } from "@/components/navigation/PanelContent"
import { NavigationContext } from "@/components/navigation/NavigationProvider"
import { EmailListView } from "./EmailListView"
import { EmailDetailView } from "./EmailDetailView"
import { SessionView } from "@/components/session/SessionView"

export function EmailTab() {
  const { getPanels } = useNavigation()
  const ctx = useContext(NavigationContext)
  const panels = getPanels("emails")

  return (
    <Tab id="emails">
      {panels.map((panel, index) => {
        if (index === 0) {
          return (
            <Panel key="list" id="list" variant="list">
              <EmailListView />
            </Panel>
          )
        }

        return (
          <PanelSlot key={index} panelId={panel.id} directionRef={ctx!.itemDirectionRef}>
            <Panel id={panel.id} variant={panel.type}>
              {panel.type === "detail" ? (
                <EmailDetailView itemId={panel.props.itemId} />
              ) : panel.type === "session" ? (
                <SessionView sessionId={panel.props.sessionId} />
              ) : (
                <PanelContent panel={panel} />
              )}
            </Panel>
          </PanelSlot>
        )
      })}
    </Tab>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/email/EmailTab.tsx
git commit -m "feat: add EmailTab using new navigation components"
```

---

## Chunk 3: Tasks + Calendar + Settings + Cleanup

### Task 8: TaskListView + TaskTab

Same pattern as Email. Create `TaskListView.tsx` with task-specific fieldSchema and `TaskTab.tsx`.

- [ ] **Step 1: Create TaskListView with task fieldSchema**
- [ ] **Step 2: Create TaskTab**
- [ ] **Step 3: Commit**

### Task 9: CalendarListView + CalendarTab

Same pattern. Create `CalendarListView.tsx` and `CalendarTab.tsx`.

- [ ] **Step 1: Create CalendarListView with calendar fieldSchema**
- [ ] **Step 2: Create CalendarTab**
- [ ] **Step 3: Commit**

### Task 10: Settings integration

Settings is already a single panel. Wire it into the navigation system.

- [ ] **Step 1: Add settings tab to PanelContent**
- [ ] **Step 2: Commit**

### Task 11: Full switchover in App.tsx

Replace PanelStack with the new tab-based routing. All tabs now use the new system.

- [ ] **Step 1: Replace PanelStack catch-all with tab rendering**
- [ ] **Step 2: Update sidebar to use useNavigation().switchTab**
- [ ] **Step 3: Browser verify all tabs**
- [ ] **Step 4: Commit**

### Task 12: Cleanup

- [ ] **Step 1: Remove PanelStack.tsx (891 lines)**
- [ ] **Step 2: Remove use-spatial-nav.tsx (245 lines)**
- [ ] **Step 3: Remove use-header-nav.ts (11 lines)**
- [ ] **Step 4: Remove RecentPane.tsx**
- [ ] **Step 5: Update sidebar recent sessions to use useNavigation**
- [ ] **Step 6: Run full test suite**
- [ ] **Step 7: Run e2e tests**
- [ ] **Step 8: Commit**

---

## Summary

| Chunk | Tasks | What |
|-------|-------|------|
| 1: Sessions + Wiring | Tasks 1-4 | SessionListView, SessionTab, PanelContent, App.tsx integration |
| 2: Emails | Tasks 5-7 | EmailListView, EmailDetailView, EmailTab |
| 3: Rest + Cleanup | Tasks 8-12 | Tasks, Calendar, Settings, full switchover, PanelStack removal |

**Execution order:** Tasks 1-4 must complete first (establishes the pattern). Tasks 5-7 and 8-10 can overlap. Tasks 11-12 must be last.
