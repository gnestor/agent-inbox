import { useEffect, useRef, useState, useDeferredValue } from "react"
import { useNavigate } from "react-router-dom"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  Combobox,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxEmpty,
  useComboboxAnchor,
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
import { PanelHeader } from "@/components/shared/PanelHeader"
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
  const [showFilters, setShowFilters] = usePreference("sessions.showFilters", false)
  const [showProject, setShowProject] = usePreference("sessions.showProject", true)
  const [showStatus, setShowStatus] = usePreference("sessions.showStatus", true)
  const statusAnchor = useComboboxAnchor()
  const projectAnchor = useComboboxAnchor()

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
  const navigate = useNavigate()

  const filteredSessions = sessions

  const scrollRef = useRef<HTMLDivElement>(null)

  // Reset scroll position when filters/search change so the top of results is visible
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [deferredSearch, statusFilter, projectFilter])

  const virtualizer = useVirtualizer({
    count: filteredSessions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 76,
    overscan: 5,
    useAnimationFrameWithResizeObserver: true,
  })

  // Reset cached measurements when the session list changes (e.g. search results arrive).
  // Without this, stale heights from the previous list are reused for new items at the
  // same indices, causing rows to overlap until ResizeObserver corrects them.
  useEffect(() => {
    virtualizer.measure()
  }, [filteredSessions])

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
            <h2 className="font-semibold text-sm">Sessions</h2>
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
                <DropdownMenuCheckboxItem checked={showProject} onCheckedChange={setShowProject}>
                  Project
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
            placeholder="Search sessions..."
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
              items={STATUS_ITEMS}
            >
              <ComboboxChips ref={statusAnchor} className="min-h-8 text-xs">
                {statusFilter.map((v) => (
                  <ComboboxChip key={v}>{STATUS_LABEL_MAP[v] || v}</ComboboxChip>
                ))}
                <ComboboxChipsInput
                  placeholder={statusFilter.length === 0 ? "Status..." : ""}
                  className="text-xs"
                />
              </ComboboxChips>
              <ComboboxContent anchor={statusAnchor}>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item.value} value={item.value}>
                      {item.label}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <Combobox
              multiple
              value={projectFilter}
              onValueChange={setProjectFilter}
              items={projectOptions}
            >
              <ComboboxChips ref={projectAnchor} className="min-h-8 text-xs">
                {projectFilter.map((v) => (
                  <ComboboxChip key={v}>{v}</ComboboxChip>
                ))}
                <ComboboxChipsInput
                  placeholder={projectFilter.length === 0 ? "Project..." : ""}
                  className="text-xs"
                />
              </ComboboxChips>
              <ComboboxContent anchor={projectAnchor}>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
                <ComboboxEmpty>No projects found</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
          </>
        )}
      </div>
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
                badges.push({ label: session.project, variant: "outline" })
              }
              if (session.linkedEmailId) {
                badges.push({ label: "Email", variant: "secondary" })
              }
              if (session.linkedTaskId) {
                badges.push({ label: "Task", variant: "secondary" })
              }
              return (
                <div
                  key={session.id}
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
                    title={session.summary || truncate(session.prompt, 60)}
                    timestamp={formatRelativeDate(session.updatedAt)}
                    badges={badges}
                    isSelected={selectedSessionId === session.id}
                    onClick={() => navigate(`/sessions/${session.id}`)}
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
