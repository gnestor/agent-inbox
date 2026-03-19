import { useNavigation } from "@/hooks/use-navigation"
import { ListView } from "@/components/shared/ListView"
import { useTasks } from "@/hooks/use-tasks"
import type { FieldDef } from "@/types/plugin"

export const taskFieldSchema: FieldDef[] = [
  { id: "title", label: "Title", type: "text", listRole: "title" },
  { id: "updatedAt", label: "Updated", type: "date", listRole: "timestamp" },
  {
    id: "status",
    label: "Status",
    type: "select",
    badge: { show: "always", variant: "outline" },
    filter: { filterable: true },
  },
  {
    id: "priority",
    label: "Priority",
    type: "select",
    badge: { show: "if-set", variant: "secondary" },
    filter: { filterable: true },
  },
  {
    id: "tags",
    label: "Tags",
    type: "multiselect",
    badge: { show: "if-set", variant: "secondary" },
    filter: { filterable: true },
  },
  {
    id: "assignee",
    label: "Assignee",
    type: "text",
    badge: { show: "if-set", variant: "secondary" },
    filter: { filterable: true },
  },
  { id: "body", label: "Body", type: "text", listRole: "hidden" },
]

export function TaskListView() {
  const { selectItem, getSelectedItemId, getFilters, setFilter } = useNavigation()
  const filters = getFilters("tasks")
  const { tasks, loading, error, hasMore, loadMore } = useTasks(
    Object.keys(filters).length > 0 ? filters : undefined,
  )

  return (
    <ListView
      title="Tasks"
      items={tasks as unknown as Record<string, unknown>[]}
      loading={loading}
      error={error}
      fieldSchema={taskFieldSchema}
      getItemId={(t) => t.id as string}
      selectedId={getSelectedItemId("tasks")}
      onSelect={selectItem}
      itemHeight={74}
      activeFilters={filters}
      onFilterChange={setFilter}
      hasMore={hasMore}
      loadMore={loadMore}
      onSearch={(q) => setFilter("q", q)}
      searchPlaceholder="Search tasks..."
    />
  )
}
