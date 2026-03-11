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
import { Calendar, SlidersHorizontal, Ellipsis, Loader2 } from "lucide-react"
import { useCalendar } from "@/hooks/use-calendar"
import { getNotionOptions, getCalendarAssignees } from "@/api/client"
import { formatRelativeDate, taskStatusBadgeClass } from "@/lib/formatters"
import { ListItem } from "@/components/shared/ListItem"
import type { ListItemBadge } from "@/components/shared/ListItem"
import { EmptyState } from "@/components/shared/EmptyState"
import { ListSkeleton } from "@/components/shared/ListSkeleton"
import { PanelHeader, SidebarButton } from "@/components/shared/PanelHeader"
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
  const [showFilters, setShowFilters] = usePreference("calendar.showFilters", false)
  const [showStatus, setShowStatus] = usePreference("calendar.showStatus", true)
  const [showTags, setShowTags] = usePreference("calendar.showTags", true)
  const [showAssignee, setShowAssignee] = usePreference("calendar.showAssignee", true)
  const [assigneeOptions, setAssigneeOptions] = useState<string[]>([])
  const [assigneeFilter, setAssigneeFilter] = usePreference<string[]>("calendar.assigneeFilter", [])
  const statusAnchor = useComboboxAnchor()
  const tagAnchor = useComboboxAnchor()
  const assigneeAnchor = useComboboxAnchor()

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
  const navigate = useNavigate()
  const filteredItems = useMemo(() => {
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter((i) => i.title.toLowerCase().includes(q))
  }, [items, search])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 66,
    overscan: 5,
    useAnimationFrameWithResizeObserver: true,
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
      <div className="px-2 py-2 border-b space-y-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
          <input
            className="min-h-8 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            placeholder="Search calendar..."
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
                    .map((tag) => ({ label: tag, variant: "secondary" as const })),
                )
              }
              if (showAssignee && item.assignee) {
                badges.push({ label: item.assignee, variant: "outline" as const })
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
                    onClick={() => navigate(`/calendar/${item.id}`)}
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
