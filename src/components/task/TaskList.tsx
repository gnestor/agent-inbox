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
import { CheckSquare, SlidersHorizontal, Ellipsis, Loader2 } from "lucide-react"
import { useTasks } from "@/hooks/use-tasks"
import { getNotionOptions, getTaskAssignees } from "@/api/client"
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

interface TaskListProps {
  selectedTaskId?: string
  onSelectedIndexChange?: (index: number) => void
  onSelectedTitleChange?: (title: string) => void
  enabled?: boolean
}

export function TaskList({
  selectedTaskId,
  onSelectedIndexChange,
  onSelectedTitleChange,
  enabled = true,
}: TaskListProps) {
  const [statusOptions, setStatusOptions] = useState<string[]>([])
  const [priorityOptions, setPriorityOptions] = useState<string[]>([])
  const [tagOptions, setTagOptions] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = usePreference<string[]>("tasks.statusFilter", [])
  const [priorityFilter, setPriorityFilter] = usePreference<string[]>("tasks.priorityFilter", [])
  const [tagFilter, setTagFilter] = usePreference<string[]>("tasks.tagFilter", [])
  const [search, setSearch] = useState("")
  const [showStatus, setShowStatus] = usePreference("tasks.showStatus", true)
  const [showTags, setShowTags] = usePreference("tasks.showTags", true)
  const [showPriority, setShowPriority] = usePreference("tasks.showPriority", false)
  const [showAssignee, setShowAssignee] = usePreference("tasks.showAssignee", true)
  const [assigneeOptions, setAssigneeOptions] = useState<string[]>([])
  const [assigneeFilter, setAssigneeFilter] = usePreference<string[]>("tasks.assigneeFilter", [])

  useEffect(() => {
    Promise.all([
      getNotionOptions("Status"),
      getNotionOptions("Priority"),
      getNotionOptions("Tags"),
      getTaskAssignees(),
    ])
      .then(([s, p, t, a]) => {
        setStatusOptions(s.options.map((o) => o.value))
        setPriorityOptions(p.options.map((o) => o.value))
        setTagOptions(t.options.map((o) => o.value))
        setAssigneeOptions(a.assignees)
      })
      .catch(() => {})
  }, [])

  const hasActiveFilters =
    statusFilter.length > 0 ||
    priorityFilter.length > 0 ||
    tagFilter.length > 0 ||
    assigneeFilter.length > 0

  const filters: Record<string, string> = {}
  if (statusFilter.length > 0) filters.status = statusFilter.join(",")
  if (priorityFilter.length > 0) filters.priority = priorityFilter.join(",")
  if (tagFilter.length > 0) filters.tags = tagFilter.join(",")
  if (assigneeFilter.length > 0) filters.assignee = assigneeFilter.join(",")

  const { tasks, loading, loadingMore, error, loadMore, hasMore } = useTasks(
    Object.keys(filters).length > 0 ? filters : undefined,
    enabled,
  )
  const { selectItem } = useNavigation()
  const filteredTasks = useMemo(() => {
    if (!search) return tasks
    const q = search.toLowerCase()
    return tasks.filter((t) => t.title.toLowerCase().includes(q))
  }, [tasks, search])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizerSafe({
    count: filteredTasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 66,
    getItemKey: (index) => filteredTasks[index]?.id ?? index,
    overscan: 5,
  })

  useVirtualInfiniteScroll(virtualizer, loadMore, hasMore, loading || loadingMore)

  // Report index synchronously during render (only updates refs, no state)
  const selectedIdx = selectedTaskId ? filteredTasks.findIndex((t) => t.id === selectedTaskId) : -1
  if (selectedIdx !== -1) onSelectedIndexChange?.(selectedIdx)

  // Title uses a state setter in the parent — must be in an effect
  const selectedTitle = selectedIdx !== -1 ? filteredTasks[selectedIdx].title : undefined
  useEffect(() => {
    if (selectedTitle !== undefined) onSelectedTitleChange?.(selectedTitle)
  }, [selectedTitle])

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        left={
          <>
            <SidebarButton />
            <h2 className="font-semibold text-sm">Tasks</h2>
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
                  value={priorityFilter}
                  onValueChange={setPriorityFilter}
                  items={priorityOptions}
                  placeholder="Priority..."
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
                  <DropdownMenuCheckboxItem checked={showPriority} onCheckedChange={setShowPriority}>
                    Priority
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
      <SearchInput value={search} onChange={setSearch} placeholder="Search tasks..." />
      <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
        {loading && <ListSkeleton itemHeight={74} />}
        {error && <div className="p-3 text-sm text-destructive">{error}</div>}
        {!loading && filteredTasks.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const task = filteredTasks[virtualRow.index]
              const badges: ListItemBadge[] = []
              if (showStatus) {
                badges.push({
                  label: task.status,
                  variant: "outline",
                  className: taskStatusBadgeClass(task.status),
                })
              }
              if (showPriority && task.priority) {
                badges.push({ label: task.priority, className: "bg-foreground/10 text-muted-foreground" })
              }
              if (showTags) {
                badges.push(
                  ...task.tags
                    .slice(0, 3)
                    .map((tag) => ({ label: tag, className: "bg-foreground/10 text-muted-foreground" })),
                )
              }
              if (showAssignee && task.assignee) {
                badges.push({ label: task.assignee, className: "bg-foreground/10 text-muted-foreground" })
              }
              return (
                <div
                  key={task.id}
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
                    title={task.title}
                    timestamp={formatRelativeDate(task.updatedAt)}
                    badges={badges}
                    isSelected={selectedTaskId === task.id}
                    onClick={() => selectItem(task.id, virtualRow.index)}
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
        {!loading && filteredTasks.length === 0 && !error && (
          <EmptyState icon={CheckSquare} message="No tasks found" />
        )}
      </div>
    </div>
  )
}
