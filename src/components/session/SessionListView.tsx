import { useMemo } from "react"
import { useSessions } from "@/hooks/use-sessions"
import { useNavigation } from "@/hooks/use-navigation"
import { ListView } from "@/components/shared/ListView"
import { sessionStatusBadgeClass, sessionStatusLabel } from "@/lib/formatters"
import { BadgeToggleMenu } from "@/components/shared/BadgeToggleMenu"
import { usePreference } from "@/hooks/use-preferences"
import { cleanFilters } from "@/lib/navigation-storage"
import type { FieldDef } from "@/types/plugin"
import { Plus } from "lucide-react"

const SESSION_FILTER_STATUSES = ["running", "complete", "awaiting_user_input", "errored", "archived"] as const

const sessionFieldSchema: FieldDef[] = [
  { id: "summary", label: "Title", type: "text", listRole: "title" },
  { id: "updatedAt", label: "Updated", type: "date", listRole: "timestamp" },
  {
    id: "status",
    label: "Status",
    type: "select",
    badge: {
      show: "always",
      variant: "outline",
      labelFn: sessionStatusLabel,
      colorFn: sessionStatusBadgeClass,
    },
    filter: {
      filterable: true,
      filterOptions: SESSION_FILTER_STATUSES.map((s) => ({ value: s, label: sessionStatusLabel(s) })),
    },
  },
  {
    id: "linkedEmailId",
    label: "Email",
    type: "text",
    listRole: "hidden",
    badge: { show: "if-set" },
  },
  {
    id: "linkedTaskId",
    label: "Task",
    type: "text",
    listRole: "hidden",
    badge: { show: "if-set" },
  },
  { id: "prompt", label: "Prompt", type: "text", listRole: "hidden" },
]

const sessionOptionsFetcher: Record<string, () => Promise<string[]>> = {}

const getId = (s: Record<string, unknown>) => s.id as string

export function SessionListView() {
  const { selectItem, getSelectedItemId, getFilters, setFilter, openNewSession } = useNavigation()
  const filters = getFilters("sessions")
  // We intentionally ignore the `error` field from useSessions here: when the
  // backend is unreachable, SessionConnectionSurface already shows a sonner
  // toast with the WS connection state, so a duplicate inline red banner is
  // redundant. Showing the cached list (data ?? []) is a better UX — users
  // keep their scroll position and can navigate to recently-viewed sessions.
  const { sessions, loading } = useSessions(cleanFilters(filters))

  const [showStatus, setShowStatus] = usePreference("sessions.showStatus", true)
  const hiddenBadgeFields = useMemo(() => {
    const hidden = new Set<string>()
    if (!showStatus) hidden.add("status")
    return hidden
  }, [showStatus])

  const items = sessions.map((s) => ({
    ...s,
    summary: s.summary || (s.prompt ? s.prompt.slice(0, 60) : "Untitled session"),
  }))

  return (
    <ListView
      items={items}
      fieldSchema={sessionFieldSchema}
      getItemId={getId}
      selectedId={getSelectedItemId("sessions")}
      onSelect={selectItem}
    >
      <ListView.Header title="Sessions">
        <ListView.Filters
          activeFilters={filters}
          onFilterChange={setFilter}
          optionsFetcher={sessionOptionsFetcher}
        />
        <BadgeToggleMenu
          items={[
            { label: "Status", checked: showStatus, onChange: setShowStatus },
          ]}
        />
        <button
          onClick={() => openNewSession()}
          className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
      </ListView.Header>
      <ListView.Search
        placeholder="Search sessions..."
        value={filters.q ?? ""}
        onSearch={(q) => setFilter("q", q)}
      />
      <ListView.Body
        itemHeight={74}
        loading={loading}
        hiddenBadgeFields={hiddenBadgeFields}
        emptyMessage="No sessions found"
      />
    </ListView>
  )
}
