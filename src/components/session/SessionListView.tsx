import { useMemo } from "react"
import { useSessions } from "@/hooks/use-sessions"
import { useNavigation } from "@/hooks/use-navigation"
import { ListView } from "@/components/shared/ListView"
import { getSessionProjects } from "@/api/client"
import { sessionStatusBadgeClass } from "@/lib/formatters"
import { BadgeToggleMenu } from "@/components/shared/BadgeToggleMenu"
import { usePreference } from "@/hooks/use-preferences"
import type { FieldDef } from "@/types/plugin"
import { Plus } from "lucide-react"

const STATUS_LABEL_MAP: Record<string, string> = {
  running: "Running",
  complete: "Complete",
  needs_attention: "Needs Attention",
  errored: "Errored",
  archived: "Archived",
}

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
      colorFn: (val) => sessionStatusBadgeClass(val),
    },
    filter: { filterable: true, filterOptions: ["running", "complete", "errored", "archived"] },
  },
  {
    id: "project",
    label: "Project",
    type: "text",
    listRole: "hidden",
    badge: { show: "if-set" },
    filter: { filterable: true },
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

const sessionOptionsFetcher: Record<string, () => Promise<string[]>> = {
  project: () => getSessionProjects().then((r) => r.projects),
}

export function SessionListView() {
  const { selectItem, getSelectedItemId, getFilters, setFilter, pushPanel } = useNavigation()
  const filters = getFilters("sessions")
  const { sessions, loading, error } = useSessions(
    Object.keys(filters).length > 0 ? filters : undefined,
  )

  const [showStatus, setShowStatus] = usePreference("sessions.showStatus", true)
  const [showProject, setShowProject] = usePreference("sessions.showProject", true)

  const hiddenBadgeFields = useMemo(() => {
    const hidden = new Set<string>()
    if (!showStatus) hidden.add("status")
    if (!showProject) hidden.add("project")
    return hidden
  }, [showStatus, showProject])

  // Fallback: use prompt as title if summary is empty
  // Map status to human-readable labels
  const items = sessions.map((s) => ({
    ...s,
    summary: s.summary || (s.prompt ? s.prompt.slice(0, 60) : "Untitled session"),
    status: STATUS_LABEL_MAP[s.status] || s.status,
  }))

  return (
    <ListView
      title="Sessions"
      items={items}
      loading={loading}
      error={error}
      fieldSchema={sessionFieldSchema}
      getItemId={(s) => s.id}
      selectedId={getSelectedItemId("sessions")}
      onSelect={selectItem}
      itemHeight={74}
      activeFilters={filters}
      onFilterChange={setFilter}
      onSearch={(q) => setFilter("q", q)}
      searchPlaceholder="Search sessions..."
      optionsFetcher={sessionOptionsFetcher}
      hiddenBadgeFields={hiddenBadgeFields}
      headerRight={
        <div className="flex items-center gap-1">
          <BadgeToggleMenu
            items={[
              { label: "Status", checked: showStatus, onChange: setShowStatus },
              { label: "Project", checked: showProject, onChange: setShowProject },
            ]}
          />
          <button
            onClick={() =>
              pushPanel({ id: "new_session", type: "new_session", props: {} })
            }
            className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      }
    />
  )
}
