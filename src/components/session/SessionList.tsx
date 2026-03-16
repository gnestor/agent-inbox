import { useEffect, useRef, useState, useDeferredValue } from "react"
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
import { Bot, SlidersHorizontal, Ellipsis } from "lucide-react"
import { useSessions } from "@/hooks/use-sessions"
import { getSessionProjects } from "@/api/client"
import { formatRelativeDate, truncate, sessionStatusBadgeClass } from "@/lib/formatters"
import { ListItem } from "@/components/shared/ListItem"
import type { ListItemBadge } from "@/components/shared/ListItem"
import { EmptyState } from "@/components/shared/EmptyState"
import { ListSkeleton } from "@/components/shared/ListSkeleton"
import { PanelHeader, SidebarButton } from "@/components/shared/PanelHeader"
import { SearchInput } from "@/components/shared/SearchInput"
import { FilterCombobox } from "@/components/shared/FilterCombobox"
import { usePreference } from "@/hooks/use-preferences"

const STATUS_ITEMS = [
  { value: "running", label: "Running" },
  { value: "complete", label: "Complete" },
  { value: "needs_attention", label: "Needs Attention" },
  { value: "errored", label: "Errored" },
]

const STATUS_LABEL_MAP: Record<string, string> = Object.fromEntries(
  STATUS_ITEMS.map((s) => [s.value, s.label]),
)

interface SessionListProps {
  selectedSessionId?: string
  onSelectedIndexChange?: (index: number) => void
  onSelectedTitleChange?: (title: string) => void
  enabled?: boolean
}

export function SessionList({
  selectedSessionId,
  onSelectedIndexChange,
  onSelectedTitleChange,
  enabled = true,
}: SessionListProps) {
  const [statusFilter, setStatusFilter] = usePreference<string[]>("sessions.statusFilter", [])
  const [projectFilter, setProjectFilter] = usePreference<string[]>("sessions.projectFilter", [])
  const [projectOptions, setProjectOptions] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [showProject, setShowProject] = usePreference("sessions.showProject", true)
  const [showStatus, setShowStatus] = usePreference("sessions.showStatus", true)

  useEffect(() => {
    getSessionProjects()
      .then((r) => setProjectOptions(r.projects))
      .catch(() => {})
  }, [])

  const hasActiveFilters = statusFilter.length > 0 || projectFilter.length > 0

  const deferredSearch = useDeferredValue(search)

  const filters: Record<string, string> = {}
  if (statusFilter.length > 0) filters.status = statusFilter.join(",")
  if (projectFilter.length > 0) filters.project = projectFilter.join(",")
  if (deferredSearch) filters.q = deferredSearch

  const { sessions, loading, error } = useSessions(
    Object.keys(filters).length > 0 ? filters : undefined,
    enabled,
  )
  const { selectItem } = useNavigation()

  const filteredSessions = sessions

  const scrollRef = useRef<HTMLDivElement>(null)

  // Reset scroll position when filters/search change so the top of results is visible
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [deferredSearch, statusFilter, projectFilter])

  const ROW_HEIGHT = 76
  const virtualizer = useVirtualizerSafe({
    count: filteredSessions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => filteredSessions[index]?.id ?? index,
    overscan: 5,
  })

  // Report index synchronously during render (only updates refs, no state)
  const selectedIdx = selectedSessionId
    ? filteredSessions.findIndex((s) => s.id === selectedSessionId)
    : -1
  if (selectedIdx !== -1) onSelectedIndexChange?.(selectedIdx)

  // Title uses a state setter in the parent — must be in an effect
  const selectedTitle =
    selectedIdx !== -1
      ? filteredSessions[selectedIdx].summary || filteredSessions[selectedIdx].prompt
      : undefined
  useEffect(() => {
    if (selectedTitle !== undefined) onSelectedTitleChange?.(selectedTitle)
  }, [selectedTitle])

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        left={
          <>
            <SidebarButton />
            <h2 className="font-semibold text-sm">Sessions</h2>
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
                  items={STATUS_ITEMS}
                  placeholder="Status..."
                  labelMap={STATUS_LABEL_MAP}
                />
                <FilterCombobox
                  value={projectFilter}
                  onValueChange={setProjectFilter}
                  items={projectOptions}
                  placeholder="Project..."
                  emptyMessage="No projects found"
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
                  <DropdownMenuCheckboxItem checked={showProject} onCheckedChange={setShowProject}>
                    Project
                  </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <SearchInput value={search} onChange={setSearch} placeholder="Search sessions..." />
      <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
        {loading && <ListSkeleton itemHeight={80} />}
        {error && <div className="p-3 text-sm text-destructive">{error}</div>}
        {!loading && filteredSessions.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const session = filteredSessions[virtualRow.index]
              const badges: ListItemBadge[] = []
              if (showStatus) {
                badges.push({
                  label: STATUS_LABEL_MAP[session.status] || session.status,
                  variant: "outline",
                  className: sessionStatusBadgeClass(session.status),
                })
              }
              if (showProject && session.project) {
                badges.push({ label: session.project, className: "bg-foreground/10 text-muted-foreground" })
              }
              if (session.linkedEmailId) {
                badges.push({ label: "Email", className: "bg-foreground/10 text-muted-foreground" })
              }
              if (session.linkedTaskId) {
                badges.push({ label: "Task", className: "bg-foreground/10 text-muted-foreground" })
              }
              return (
                <div
                  key={session.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${ROW_HEIGHT}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ListItem
                    title={session.summary || truncate(session.prompt, 60) || "Untitled session"}
                    timestamp={formatRelativeDate(session.updatedAt)}
                    badges={badges}
                    isSelected={selectedSessionId === session.id}
                    onClick={() => selectItem(session.id, virtualRow.index)}
                  />
                </div>
              )
            })}
          </div>
        )}
        {!loading && filteredSessions.length === 0 && !error && (
          <EmptyState icon={Bot} message="No sessions yet" />
        )}
      </div>
    </div>
  )
}
