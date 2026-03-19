import { useMemo } from "react"
import { useNavigation } from "@/hooks/use-navigation"
import { ListView } from "@/components/shared/ListView"
import { useCalendar } from "@/hooks/use-calendar"
import { getNotionOptions, getCalendarAssignees } from "@/api/client"
import { BadgeToggleMenu } from "@/components/shared/BadgeToggleMenu"
import { usePreference } from "@/hooks/use-preferences"
import type { FieldDef } from "@/types/plugin"

export const calendarFieldSchema: FieldDef[] = [
  { id: "title", label: "Title", type: "text", listRole: "title" },
  { id: "date", label: "Date", type: "date", listRole: "timestamp" },
  {
    id: "status",
    label: "Status",
    type: "select",
    badge: { show: "always", variant: "outline" },
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
]

const calendarOptionsFetcher: Record<string, () => Promise<string[]>> = {
  status: () => getNotionOptions("calendar:Status").then((r) => r.options.map((o) => o.value)),
  tags: () => getNotionOptions("calendar:Tags").then((r) => r.options.map((o) => o.value)),
  assignee: () => getCalendarAssignees().then((r) => r.assignees),
}

export function CalendarListView() {
  const { selectItem, getSelectedItemId, getFilters, setFilter } = useNavigation()
  const filters = getFilters("calendar")
  const { items, loading, error, hasMore, loadMore } = useCalendar(
    Object.keys(filters).length > 0 ? filters : undefined,
  )

  const [showStatus, setShowStatus] = usePreference("calendar.showStatus", true)
  const [showTags, setShowTags] = usePreference("calendar.showTags", true)
  const [showAssignee, setShowAssignee] = usePreference("calendar.showAssignee", true)

  const hiddenBadgeFields = useMemo(() => {
    const hidden = new Set<string>()
    if (!showStatus) hidden.add("status")
    if (!showTags) hidden.add("tags")
    if (!showAssignee) hidden.add("assignee")
    return hidden
  }, [showStatus, showTags, showAssignee])

  return (
    <ListView
      title="Calendar"
      items={items as unknown as Record<string, unknown>[]}
      loading={loading}
      error={error}
      fieldSchema={calendarFieldSchema}
      getItemId={(item) => item.id as string}
      selectedId={getSelectedItemId("calendar")}
      onSelect={selectItem}
      activeFilters={filters}
      onFilterChange={setFilter}
      hasMore={hasMore}
      loadMore={loadMore}
      onSearch={(q) => setFilter("q", q)}
      searchPlaceholder="Search calendar..."
      optionsFetcher={calendarOptionsFetcher}
      hiddenBadgeFields={hiddenBadgeFields}
      headerRight={
        <BadgeToggleMenu
          items={[
            { label: "Status", checked: showStatus, onChange: setShowStatus },
            { label: "Tags", checked: showTags, onChange: setShowTags },
            { label: "Assignee", checked: showAssignee, onChange: setShowAssignee },
          ]}
        />
      }
    />
  )
}
