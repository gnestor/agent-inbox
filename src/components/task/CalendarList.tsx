import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigation } from "@/hooks/use-navigation"
import { useVirtualizerSafe } from "@/hooks/use-virtualizer-safe"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@hammies/frontend/components/ui"
import { Calendar, SlidersHorizontal, Ellipsis, Loader2 } from "lucide-react"
import { useCalendar } from "@/hooks/use-calendar"
import { getNotionOptions, getCalendarAssignees } from "@/api/client"
import { formatRelativeDate, taskStatusBadgeClass } from "@/lib/formatters"
import { ListItem } from "@/components/shared/ListItem"
import type { ListItemBadge } from "@/components/shared/ListItem"
import { EmptyState } from "@/components/shared/EmptyState"
import { ListSkeleton } from "@/components/shared/ListSkeleton"
import { PanelHeader, SidebarButton } from "@/components/shared/PanelHeader"
import { SearchInput } from "@/components/shared/SearchInput"
import { FilterCombobox } from "@/components/shared/FilterCombobox"
import { usePreference } from "@/hooks/use-preferences"
import { useVirtualInfiniteScroll } from "@/hooks/use-infinite-scroll"

interface CalendarListProps {
  selectedItemId?: string
  onSelectedIndexChange?: (index: number) => void
  onSelectedTitleChange?: (title: string) => void
  enabled?: boolean
}

export function CalendarList({
  selectedItemId,
  onSelectedIndexChange,
  onSelectedTitleChange,
  enabled = true,
}: CalendarListProps) {
  const [statusOptions, setStatusOptions] = useState<string[]>([])
  const [tagOptions, setTagOptions] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = usePreference<string[]>("calendar.statusFilter", [])
  const [tagFilter, setTagFilter] = usePreference<string[]>("calendar.tagFilter", [])
  const [search, setSearch] = useState("")
  const [showStatus, setShowStatus] = usePreference("calendar.showStatus", true)
  const [showTags, setShowTags] = usePreference("calendar.showTags", true)
  const [showAssignee, setShowAssignee] = usePreference("calendar.showAssignee", true)
  const [assigneeOptions, setAssigneeOptions] = useState<string[]>([])
  const [assigneeFilter, setAssigneeFilter] = usePreference<string[]>("calendar.assigneeFilter", [])

  useEffect(() => {
    Promise.all([
      getNotionOptions("calendar:Status"),
      getNotionOptions("calendar:Tags"),
      getCalendarAssignees(),
    ])
      .then(([s, t, a]) => {
        setStatusOptions(s.options.map((o) => o.value))
        setTagOptions(t.options.map((o) => o.value))
        setAssigneeOptions(a.assignees)
      })
      .catch(() => {})
  }, [])

  const hasActiveFilters =
    statusFilter.length > 0 || tagFilter.length > 0 || assigneeFilter.length > 0

  const filters: Record<string, string> = {}
  if (statusFilter.length > 0) filters.status = statusFilter.join(",")
  if (tagFilter.length > 0) filters.tags = tagFilter.join(",")
  if (assigneeFilter.length > 0) filters.assignee = assigneeFilter.join(",")

  const { items, loading, loadingMore, error, loadMore, hasMore } = useCalendar(
    Object.keys(filters).length > 0 ? filters : undefined,
    enabled,
  )
  const { selectItem } = useNavigation()
  const filteredItems = useMemo(() => {
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter((i) => i.title.toLowerCase().includes(q))
  }, [items, search])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizerSafe({
    count: filteredItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 66,
    getItemKey: (index) => filteredItems[index]?.id ?? index,
    overscan: 5,
  })

  useVirtualInfiniteScroll(virtualizer, loadMore, hasMore, loading || loadingMore)

  const selectedIdx = selectedItemId ? filteredItems.findIndex((i) => i.id === selectedItemId) : -1
  if (selectedIdx !== -1) onSelectedIndexChange?.(selectedIdx)

  const selectedTitle = selectedIdx !== -1 ? filteredItems[selectedIdx].title : undefined
  useEffect(() => {
    if (selectedTitle !== undefined) onSelectedTitleChange?.(selectedTitle)
  }, [selectedTitle])

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        left={
          <>
            <SidebarButton />
            <h2 className="font-semibold text-sm">Calendar</h2>
          </>
        }
        right={
          <>
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className={`shrink-0 p-1.5 rounded-md hover:bg-secondary ${hasActiveFilters ? "text-sidebar-primary" : "text-muted-foreground"}`}
                    title="Filters"
                  />
                }
              >
                <SlidersHorizontal className="h-4 w-4" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-3 space-y-1.5">
                <FilterCombobox
                  value={statusFilter}
                  onValueChange={setStatusFilter}
                  items={statusOptions}
                  placeholder="Status..."
                />
                <FilterCombobox
                  value={tagFilter}
                  onValueChange={setTagFilter}
                  items={tagOptions}
                  placeholder="Tags..."
                  emptyMessage="No tags found"
                />
                <FilterCombobox
                  value={assigneeFilter}
                  onValueChange={setAssigneeFilter}
                  items={assigneeOptions}
                  placeholder="Assignee..."
                  emptyMessage="No assignees found"
                />
              </PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
                  />
                }
              >
                <Ellipsis className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Toggle badges</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem checked={showStatus} onCheckedChange={setShowStatus}>
                    Status
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={showTags} onCheckedChange={setShowTags}>
                    Tags
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={showAssignee} onCheckedChange={setShowAssignee}>
                    Assignee
                  </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <SearchInput value={search} onChange={setSearch} placeholder="Search calendar..." />
      <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
        {loading && <ListSkeleton itemHeight={66} />}
        {error && <div className="p-3 text-sm text-destructive">{error}</div>}
        {!loading && filteredItems.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = filteredItems[virtualRow.index]
              const badges: ListItemBadge[] = []
              if (showStatus) {
                badges.push({
                  label: item.status,
                  variant: "outline",
                  className: taskStatusBadgeClass(item.status),
                })
              }
              if (showTags) {
                badges.push(
                  ...item.tags
                    .slice(0, 3)
                    .map((tag) => ({ label: tag, className: "bg-foreground/10 text-muted-foreground" })),
                )
              }
              if (showAssignee && item.assignee) {
                badges.push({ label: item.assignee, className: "bg-foreground/10 text-muted-foreground" })
              }
              return (
                <div
                  key={item.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ListItem
                    title={item.title}
                    timestamp={item.date ? formatRelativeDate(item.date) : ""}
                    badges={badges}
                    isSelected={selectedItemId === item.id}
                    onClick={() => selectItem(item.id, virtualRow.index)}
                  />
                </div>
              )
            })}
          </div>
        )}
        {loadingMore && (
          <div className="flex justify-center p-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && filteredItems.length === 0 && !error && (
          <EmptyState icon={Calendar} message="No calendar items found" />
        )}
      </div>
    </div>
  )
}
