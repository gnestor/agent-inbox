import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ScrollArea,
  Skeleton,
  Combobox,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  useComboboxAnchor,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@hammies/frontend/components/ui"
import { SidebarTrigger } from "@hammies/frontend/components/ui"
import { CheckSquare, SlidersHorizontal, Ellipsis, Loader2 } from "lucide-react"
import { useTasks } from "@/hooks/use-tasks"
import { getNotionOptions, getTaskAssignees } from "@/api/client"
import { formatRelativeDate } from "@/lib/formatters"
import { ListItem } from "@/components/shared/ListItem"
import type { ListItemBadge } from "@/components/shared/ListItem"
import { usePreference } from "@/hooks/use-preferences"
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll"

function statusBadgeClass(status: string) {
  switch (status) {
    case "Not started": return "bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30"
    case "Next Up": return "bg-chart-2/20 text-chart-2 border-chart-2/30"
    case "In Progress": return "bg-chart-3/20 text-chart-3 border-chart-3/30"
    case "Completed": return "bg-chart-1/20 text-chart-1 border-chart-1/30"
    case "Archive": return "bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30"
    default: return ""
  }
}

interface TaskListProps {
  selectedTaskId?: string
}

export function TaskList({ selectedTaskId }: TaskListProps) {
  const [statusOptions, setStatusOptions] = useState<string[]>([])
  const [priorityOptions, setPriorityOptions] = useState<string[]>([])
  const [tagOptions, setTagOptions] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = usePreference<string[]>("tasks.statusFilter", [])
  const [priorityFilter, setPriorityFilter] = usePreference<string[]>("tasks.priorityFilter", [])
  const [tagFilter, setTagFilter] = usePreference<string[]>("tasks.tagFilter", [])
  const [search, setSearch] = useState("")
  const [showFilters, setShowFilters] = usePreference("tasks.showFilters", false)
  const [showStatus, setShowStatus] = usePreference("tasks.showStatus", true)
  const [showTags, setShowTags] = usePreference("tasks.showTags", true)
  const [showPriority, setShowPriority] = usePreference("tasks.showPriority", false)
  const [showAssignee, setShowAssignee] = usePreference("tasks.showAssignee", true)
  const [assigneeOptions, setAssigneeOptions] = useState<string[]>([])
  const [assigneeFilter, setAssigneeFilter] = usePreference<string[]>("tasks.assigneeFilter", [])
  const statusAnchor = useComboboxAnchor()
  const priorityAnchor = useComboboxAnchor()
  const tagAnchor = useComboboxAnchor()
  const assigneeAnchor = useComboboxAnchor()

  useEffect(() => {
    Promise.all([
      getNotionOptions("Status"),
      getNotionOptions("Priority"),
      getNotionOptions("Tags"),
      getTaskAssignees(),
    ]).then(([s, p, t, a]) => {
      setStatusOptions(s.options.map((o) => o.value))
      setPriorityOptions(p.options.map((o) => o.value))
      setTagOptions(t.options.map((o) => o.value))
      setAssigneeOptions(a.assignees)
    }).catch(() => {})
  }, [])

  const hasActiveFilters = statusFilter.length > 0 || priorityFilter.length > 0 || tagFilter.length > 0 || assigneeFilter.length > 0

  const filters: Record<string, string> = {}
  if (statusFilter.length > 0) filters.status = statusFilter.join(",")
  if (priorityFilter.length > 0) filters.priority = priorityFilter.join(",")
  if (tagFilter.length > 0) filters.tags = tagFilter.join(",")
  if (assigneeFilter.length > 0) filters.assignee = assigneeFilter.join(",")

  const { tasks, loading, loadingMore, error, loadMore, hasMore } = useTasks(
    Object.keys(filters).length > 0 ? filters : undefined,
  )
  const navigate = useNavigate()
  const sentinelRef = useInfiniteScroll(loadMore, hasMore, loading || loadingMore)

  const filteredTasks = useMemo(() => {
    if (!search) return tasks
    const q = search.toLowerCase()
    return tasks.filter((t) => t.title.toLowerCase().includes(q))
  }, [tasks, search])

  return (
    <div className="flex flex-col h-full">
      <div className="flex h-12 shrink-0 items-center justify-between px-4 border-b">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <h2 className="font-semibold text-sm">Tasks</h2>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button" className="shrink-0 p-1.5 rounded-md hover:bg-accent text-muted-foreground" />}>
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
      </div>
      <div className="px-4 py-2 border-b space-y-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
          <input
            className="min-h-8 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" onClick={() => setShowFilters(!showFilters)} className="shrink-0 p-1 rounded hover:bg-accent">
            <SlidersHorizontal className={`h-3.5 w-3.5 ${hasActiveFilters ? "text-sidebar-primary" : "text-muted-foreground"}`} />
          </button>
        </div>
        {showFilters && (
          <>
            <Combobox multiple value={statusFilter} onValueChange={setStatusFilter} items={statusOptions}>
              <ComboboxChips ref={statusAnchor} className="min-h-8 text-xs">
                {statusFilter.map((v) => (
                  <ComboboxChip key={v}>{v}</ComboboxChip>
                ))}
                <ComboboxChipsInput placeholder={statusFilter.length === 0 ? "Status..." : ""} className="text-xs" />
              </ComboboxChips>
              <ComboboxContent anchor={statusAnchor}>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <Combobox multiple value={priorityFilter} onValueChange={setPriorityFilter} items={priorityOptions}>
              <ComboboxChips ref={priorityAnchor} className="min-h-8 text-xs">
                {priorityFilter.map((v) => (
                  <ComboboxChip key={v}>{v}</ComboboxChip>
                ))}
                <ComboboxChipsInput placeholder={priorityFilter.length === 0 ? "Priority..." : ""} className="text-xs" />
              </ComboboxChips>
              <ComboboxContent anchor={priorityAnchor}>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <Combobox multiple value={tagFilter} onValueChange={setTagFilter} items={tagOptions}>
              <ComboboxChips ref={tagAnchor} className="min-h-8 text-xs">
                {tagFilter.map((v) => (
                  <ComboboxChip key={v}>{v}</ComboboxChip>
                ))}
                <ComboboxChipsInput placeholder={tagFilter.length === 0 ? "Tags..." : ""} className="text-xs" />
              </ComboboxChips>
              <ComboboxContent anchor={tagAnchor}>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
                <ComboboxEmpty>No tags found</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
            <Combobox multiple value={assigneeFilter} onValueChange={setAssigneeFilter} items={assigneeOptions}>
              <ComboboxChips ref={assigneeAnchor} className="min-h-8 text-xs">
                {assigneeFilter.map((v) => (
                  <ComboboxChip key={v}>{v}</ComboboxChip>
                ))}
                <ComboboxChipsInput placeholder={assigneeFilter.length === 0 ? "Assignee..." : ""} className="text-xs" />
              </ComboboxChips>
              <ComboboxContent anchor={assigneeAnchor}>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
                <ComboboxEmpty>No assignees found</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
          </>
        )}
      </div>
      <ScrollArea className="flex-1 overflow-hidden">
        {loading && (
          <div className="flex flex-col gap-px">
            {Array.from({ length: 50 }).map((_, i) => (
              <Skeleton key={i} className="h-[66px] w-full rounded-none shrink-0" />
            ))}
          </div>
        )}
        {error && (
          <div className="p-3 text-sm text-destructive">{error}</div>
        )}
        {!loading &&
          filteredTasks.map((task) => {
            const badges: ListItemBadge[] = []
            if (showStatus) {
              badges.push({ label: task.status, variant: "outline", className: statusBadgeClass(task.status) })
            }
            if (showPriority && task.priority) {
              badges.push({ label: task.priority, variant: "outline" })
            }
            if (showTags) {
              badges.push(...task.tags.slice(0, 3).map((tag) => ({ label: tag, variant: "secondary" as const })))
            }
            if (showAssignee && task.assignee) {
              badges.push({ label: task.assignee, variant: "outline" as const })
            }
            return (
              <ListItem
                key={task.id}
                title={task.title}
                timestamp={formatRelativeDate(task.updatedAt)}
                badges={badges}
                isSelected={selectedTaskId === task.id}
                onClick={() => navigate(`/tasks/${task.id}`)}
              />
            )
          })}
        {!loading && hasMore && <div ref={sentinelRef} />}
        {loadingMore && (
          <div className="flex justify-center p-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && filteredTasks.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
            <CheckSquare className="h-8 w-8 mb-2" />
            <p className="text-sm">No tasks found</p>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
