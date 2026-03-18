import { useSessions } from "@/hooks/use-sessions"
import { useNavigation } from "@/hooks/use-navigation"
import { ListView } from "@/components/shared/ListView"
import type { FieldDef } from "@/types/plugin"

const sessionFieldSchema: FieldDef[] = [
  { id: "summary", label: "Title", type: "text", listRole: "title" },
  { id: "updatedAt", label: "Updated", type: "date", listRole: "timestamp" },
  {
    id: "status",
    label: "Status",
    type: "select",
    badge: { show: "always", variant: "outline" },
    filter: { filterable: true, filterOptions: ["running", "complete", "errored"] },
  },
  {
    id: "project",
    label: "Project",
    type: "text",
    listRole: "hidden",
    badge: { show: "if-set" },
    filter: { filterable: true },
  },
  { id: "prompt", label: "Prompt", type: "text", listRole: "hidden" },
]

export function SessionListView() {
  const { selectItem, getSelectedItemId, activeFilters, setFilter } = useNavigation()
  const { sessions, loading, error } = useSessions(
    Object.keys(activeFilters).length > 0 ? activeFilters : undefined,
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
      selectedId={getSelectedItemId("sessions")}
      onSelect={selectItem}
      itemHeight={74}
      activeFilters={activeFilters}
      onFilterChange={setFilter}
      onSearch={(q) => setFilter("q", q)}
      searchPlaceholder="Search sessions..."
    />
  )
}
