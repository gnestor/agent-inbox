import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ScrollArea,
  Skeleton,
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
import { SidebarTrigger } from "@hammies/frontend/components/ui"
import { Bot, SlidersHorizontal, Ellipsis } from "lucide-react"
import { useSessions } from "@/hooks/use-sessions"
import { getSessionProjects } from "@/api/client"
import { formatRelativeDate, truncate } from "@/lib/formatters"
import { ListItem } from "@/components/shared/ListItem"
import type { ListItemBadge } from "@/components/shared/ListItem"
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

function statusBadgeClass(status: string) {
  switch (status) {
    case "running": return "bg-chart-3/20 text-chart-3 border-chart-3/30"
    case "complete": return "bg-chart-1/20 text-chart-1 border-chart-1/30"
    case "needs_attention": return "bg-chart-2/20 text-chart-2 border-chart-2/30"
    case "errored": return "bg-destructive/20 text-destructive border-destructive/30"
    default: return ""
  }
}

interface SessionListProps {
  selectedSessionId?: string
}

export function SessionList({ selectedSessionId }: SessionListProps) {
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

  const filters: Record<string, string> = {}
  if (statusFilter.length > 0) filters.status = statusFilter.join(",")
  if (projectFilter.length > 0) filters.project = projectFilter.join(",")

  const { sessions, loading, error } = useSessions(
    Object.keys(filters).length > 0 ? filters : undefined,
  )
  const navigate = useNavigate()

  const filteredSessions = useMemo(() => {
    if (!search) return sessions
    const q = search.toLowerCase()
    return sessions.filter(
      (s) =>
        (s.summary && s.summary.toLowerCase().includes(q)) ||
        s.prompt.toLowerCase().includes(q),
    )
  }, [sessions, search])

  return (
    <div className="flex flex-col h-full">
      <div className="flex h-12 shrink-0 items-center justify-between px-4 border-b">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <h2 className="font-semibold text-sm">Sessions</h2>
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
              <DropdownMenuCheckboxItem checked={showProject} onCheckedChange={setShowProject}>
                Project
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="px-4 py-2 border-b space-y-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
          <input
            className="min-h-8 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            placeholder="Search sessions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" onClick={() => setShowFilters(!showFilters)} className="shrink-0 p-1 rounded hover:bg-accent">
            <SlidersHorizontal className={`h-3.5 w-3.5 ${hasActiveFilters ? "text-sidebar-primary" : "text-muted-foreground"}`} />
          </button>
        </div>
        {showFilters && (
          <>
            <Combobox multiple value={statusFilter} onValueChange={setStatusFilter} items={STATUS_ITEMS}>
              <ComboboxChips ref={statusAnchor} className="min-h-8 text-xs">
                {statusFilter.map((v) => (
                  <ComboboxChip key={v}>{STATUS_LABEL_MAP[v] || v}</ComboboxChip>
                ))}
                <ComboboxChipsInput placeholder={statusFilter.length === 0 ? "Status..." : ""} className="text-xs" />
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
            <Combobox multiple value={projectFilter} onValueChange={setProjectFilter} items={projectOptions}>
              <ComboboxChips ref={projectAnchor} className="min-h-8 text-xs">
                {projectFilter.map((v) => (
                  <ComboboxChip key={v}>{v}</ComboboxChip>
                ))}
                <ComboboxChipsInput placeholder={projectFilter.length === 0 ? "Project..." : ""} className="text-xs" />
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
          filteredSessions.map((session) => {
            const badges: ListItemBadge[] = []
            if (showStatus) {
              badges.push({
                label: STATUS_LABEL_MAP[session.status] || session.status,
                variant: "outline",
                className: statusBadgeClass(session.status),
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
              <ListItem
                key={session.id}
                title={session.summary || truncate(session.prompt, 60)}
                subtitle={session.messageCount > 0 ? `${session.messageCount} messages` : undefined}
                timestamp={formatRelativeDate(session.updatedAt)}
                badges={badges}
                isSelected={selectedSessionId === session.id}
                onClick={() => navigate(`/sessions/${session.id}`)}
              />
            )
          })}
        {!loading && filteredSessions.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
            <Bot className="h-8 w-8 mb-2" />
            <p className="text-sm">No sessions yet</p>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
