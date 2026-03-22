import { useMemo } from "react"
import { useNavigation } from "@/hooks/use-navigation"
import { ListView } from "@/components/shared/ListView"
import { useTasks } from "@/hooks/use-tasks"
import { getNotionOptions, getTaskAssignees } from "@/api/client"
import { BadgeToggleMenu } from "@/components/shared/BadgeToggleMenu"
import { usePreference } from "@/hooks/use-preferences"
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

const taskOptionsFetcher: Record<string, () => Promise<string[]>> = {
  status: () => getNotionOptions("Status").then((r) => r.options.map((o) => o.value)),
  priority: () => getNotionOptions("Priority").then((r) => r.options.map((o) => o.value)),
  tags: () => getNotionOptions("Tags").then((r) => r.options.map((o) => o.value)),
  assignee: () => getTaskAssignees().then((r) => r.assignees),
}

const getId = (t: Record<string, unknown>) => t.id as string

export function TaskListView() {
  const { selectItem, getSelectedItemId, getFilters, setFilter } = useNavigation()
  const filters = getFilters("tasks")
  const { tasks, loading, error, hasMore, loadMore } = useTasks(
    Object.keys(filters).length > 0 ? filters : undefined,
  )

  const [showStatus, setShowStatus] = usePreference("tasks.showStatus", true)
  const [showPriority, setShowPriority] = usePreference("tasks.showPriority", false)
  const [showTags, setShowTags] = usePreference("tasks.showTags", true)
  const [showAssignee, setShowAssignee] = usePreference("tasks.showAssignee", true)

  const hiddenBadgeFields = useMemo(() => {
    const hidden = new Set<string>()
    if (!showStatus) hidden.add("status")
    if (!showPriority) hidden.add("priority")
    if (!showTags) hidden.add("tags")
    if (!showAssignee) hidden.add("assignee")
    return hidden
  }, [showStatus, showPriority, showTags, showAssignee])

  return (
    <ListView
      items={tasks as unknown as Record<string, unknown>[]}
      fieldSchema={taskFieldSchema}
      getItemId={getId}
      selectedId={getSelectedItemId("tasks")}
      onSelect={selectItem}
    >
      <ListView.Header title="Tasks">
        <ListView.Filters
          activeFilters={filters}
          onFilterChange={setFilter}
          optionsFetcher={taskOptionsFetcher}
        />
        <BadgeToggleMenu
          items={[
            { label: "Status", checked: showStatus, onChange: setShowStatus },
            { label: "Priority", checked: showPriority, onChange: setShowPriority },
            { label: "Tags", checked: showTags, onChange: setShowTags },
            { label: "Assignee", checked: showAssignee, onChange: setShowAssignee },
          ]}
        />
      </ListView.Header>
      <ListView.Search
        placeholder="Search tasks..."
        onSearch={(q) => setFilter("q", q)}
      />
      <ListView.Body
        itemHeight={74}
        loading={loading}
        error={error}
        hasMore={hasMore}
        loadMore={loadMore}
        hiddenBadgeFields={hiddenBadgeFields}
        emptyMessage="No tasks found"
      />
    </ListView>
  )
}
