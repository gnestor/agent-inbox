import { useNavigation } from "@/hooks/use-navigation"
import { ListView } from "@/components/shared/ListView"
import { useCalendar } from "@/hooks/use-calendar"
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

export function CalendarListView() {
  const { selectItem, getSelectedItemId, activeFilters, setFilter } = useNavigation()
  const { items, loading, error, hasMore, loadMore } = useCalendar(
    Object.keys(activeFilters).length > 0 ? activeFilters : undefined,
  )

  return (
    <ListView
      title="Calendar"
      items={items as unknown as Record<string, unknown>[]}
      loading={loading}
      error={error}
      fieldSchema={calendarFieldSchema}
      getItemId={(item) => item.id as string}
      selectedId={getSelectedItemId()}
      onSelect={selectItem}
      activeFilters={activeFilters}
      onFilterChange={setFilter}
      hasMore={hasMore}
      loadMore={loadMore}
      onSearch={(q) => setFilter("q", q)}
      searchPlaceholder="Search calendar..."
    />
  )
}
