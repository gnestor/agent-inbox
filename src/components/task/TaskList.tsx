import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
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
import { formatRelativeDate, taskStatusBadgeClass } from "@/lib/formatters"
import { ListItem } from "@/components/shared/ListItem"
import type { ListItemBadge } from "@/components/shared/ListItem"
import { EmptyState } from "@/components/shared/EmptyState"
import { ListSkeleton } from "@/components/shared/ListSkeleton"
import { PanelHeader } from "@/components/shared/PanelHeader"
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
  const navigate = useNavigate()
  const filteredTasks = useMemo(() => {
    if (!search) return tasks
    const q = search.toLowerCase()
    return tasks.filter((t) => t.title.toLowerCase().includes(q))
  }, [tasks, search])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: filteredTasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 66,
    overscan: 5,
    useAnimationFrameWithResizeObserver: true,
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
            <SidebarTrigger className="-ml-1" />
            <h2 className="font-semibold text-sm">Tasks</h2>
          </>
        }
        right={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="shrink-0 p-1.5 rounded-md hover:bg-accent text-muted-foreground"
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
        }
      />
      <div className="px-4 py-2 border-b space-y-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
          <input
            className="min-h-8 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="shrink-0 p-1 rounded hover:bg-accent"
          >
            <SlidersHorizontal
              className={`h-3.5 w-3.5 ${hasActiveFilters ? "text-sidebar-primary" : "text-muted-foreground"}`}
            />
          </button>
        </div>
        {showFilters && (
          <>
            <Combobox
              multiple
              value={statusFilter}
              onValueChange={setStatusFilter}
              items={statusOptions}
            >
              <ComboboxChips ref={statusAnchor} className="min-h-8 text-xs">
                {statusFilter.map((v) => (
                  <ComboboxChip key={v}>{v}</ComboboxChip>
                ))}
                <ComboboxChipsInput
                  placeholder={statusFilter.length === 0 ? "Status..." : ""}
                  className="text-xs"
                />
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
            <Combobox
              multiple
              value={priorityFilter}
              onValueChange={setPriorityFilter}
              items={priorityOptions}
            >
              <ComboboxChips ref={priorityAnchor} className="min-h-8 text-xs">
                {priorityFilter.map((v) => (
                  <ComboboxChip key={v}>{v}</ComboboxChip>
                ))}
                <ComboboxChipsInput
                  placeholder={priorityFilter.length === 0 ? "Priority..." : ""}
                  className="text-xs"
                />
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
                <ComboboxChipsInput
                  placeholder={tagFilter.length === 0 ? "Tags..." : ""}
                  className="text-xs"
                />
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
            <Combobox
              multiple
              value={assigneeFilter}
              onValueChange={setAssigneeFilter}
              items={assigneeOptions}
            >
              <ComboboxChips ref={assigneeAnchor} className="min-h-8 text-xs">
                {assigneeFilter.map((v) => (
                  <ComboboxChip key={v}>{v}</ComboboxChip>
                ))}
                <ComboboxChipsInput
                  placeholder={assigneeFilter.length === 0 ? "Assignee..." : ""}
                  className="text-xs"
                />
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
        {loading && <ListSkeleton itemHeight={66} />}
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
                badges.push({ label: task.priority, variant: "outline" })
              }
              if (showTags) {
                badges.push(
                  ...task.tags
                    .slice(0, 3)
                    .map((tag) => ({ label: tag, variant: "secondary" as const })),
                )
              }
              if (showAssignee && task.assignee) {
                badges.push({ label: task.assignee, variant: "outline" as const })
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
                    onClick={() => navigate(`/tasks/${task.id}`)}
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
