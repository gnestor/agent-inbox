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
import { Mail, SlidersHorizontal, Ellipsis, Loader2 } from "lucide-react"
import { useEmails } from "@/hooks/use-emails"
import { getEmailLabels } from "@/api/client"
import { formatRelativeDate, formatEmailAddress } from "@/lib/formatters"
import { ListItem } from "@/components/shared/ListItem"
import type { ListItemBadge } from "@/components/shared/ListItem"
import { EmptyState } from "@/components/shared/EmptyState"
import { ListSkeleton } from "@/components/shared/ListSkeleton"
import { PanelHeader } from "@/components/shared/PanelHeader"
import { usePreference } from "@/hooks/use-preferences"
import { useVirtualInfiniteScroll } from "@/hooks/use-infinite-scroll"
import type { GmailLabel } from "@/types"

const FILTER_OPTIONS = [
  { value: "important", label: "Important" },
  { value: "starred", label: "Starred" },
  { value: "snoozed", label: "Snoozed" },
  { value: "unread", label: "Unread" },
]

const FILTER_LABEL_MAP: Record<string, string> = Object.fromEntries(
  FILTER_OPTIONS.map((o) => [o.value, o.label]),
)

interface EmailListProps {
  selectedThreadId?: string
  onSelectedIndexChange?: (index: number) => void
  onSelectedTitleChange?: (title: string) => void
  enabled?: boolean
}

export function EmailList({
  selectedThreadId,
  onSelectedIndexChange,
  onSelectedTitleChange,
  enabled = true,
}: EmailListProps) {
  const [filters, setFilters] = usePreference<string[]>("emails.filters", ["important", "starred"])
  const [selectedLabels, setSelectedLabels] = usePreference<string[]>("emails.labels", [])
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [showFilters, setShowFilters] = usePreference("emails.showFilters", false)
  const [showReadStatus, setShowReadStatus] = usePreference("emails.showReadStatus", true)
  const [showLabels, setShowLabels] = usePreference("emails.showLabels", false)
  const [showImportant, setShowImportant] = usePreference("emails.showImportant", true)
  const [showStarred, setShowStarred] = usePreference("emails.showStarred", true)
  const [labels, setLabels] = useState<GmailLabel[]>([])
  const filterAnchor = useComboboxAnchor()
  const labelAnchor = useComboboxAnchor()

  useEffect(() => {
    getEmailLabels()
      .then((r) =>
        setLabels(
          r.labels.filter((l) => l.type === "user").sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
      .catch(() => {})
  }, [])

  const labelNames = useMemo(() => labels.map((l) => l.name), [labels])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(timer)
  }, [search])

  const hasActiveFilters = filters.length > 0 || selectedLabels.length > 0

  const query = useMemo(() => {
    const parts: string[] = ["in:inbox"]
    const conditions: string[] = []
    for (const f of filters) {
      conditions.push(`is:${f}`)
    }
    if (conditions.length === 1) parts.push(conditions[0])
    else if (conditions.length > 1) parts.push(`(${conditions.join(" OR ")})`)
    for (const l of selectedLabels) {
      parts.push(`label:${l.replace(/\s+/g, "-")}`)
    }
    if (debouncedSearch) parts.push(debouncedSearch)
    return parts.join(" ")
  }, [filters, selectedLabels, debouncedSearch])

  const { messages, loading, loadingMore, error, loadMore, hasMore } = useEmails(query, enabled)
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)

  const threads = useMemo(() => {
    const seen = new Set<string>()
    return messages.filter((msg) => {
      if (seen.has(msg.threadId)) return false
      seen.add(msg.threadId)
      return true
    })
  }, [messages])

  const virtualizer = useVirtualizer({
    count: threads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 88,
    overscan: 5,
    useAnimationFrameWithResizeObserver: true,
  })

  useVirtualInfiniteScroll(virtualizer, loadMore, hasMore, loading || loadingMore)

  // Report index synchronously during render (only updates refs, no state)
  const selectedIdx = selectedThreadId
    ? threads.findIndex((t) => t.threadId === selectedThreadId)
    : -1
  if (selectedIdx !== -1) onSelectedIndexChange?.(selectedIdx)

  // Title uses a state setter in the parent — must be in an effect
  const selectedTitle = selectedIdx !== -1 ? threads[selectedIdx].subject : undefined
  useEffect(() => {
    if (selectedTitle !== undefined) onSelectedTitleChange?.(selectedTitle)
  }, [selectedTitle])

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        left={
          <>
            <SidebarTrigger className="-ml-1" />
            <h2 className="font-semibold text-sm">Emails</h2>
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
                <DropdownMenuCheckboxItem
                  checked={showReadStatus}
                  onCheckedChange={setShowReadStatus}
                >
                  Read status
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={showLabels} onCheckedChange={setShowLabels}>
                  Labels
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={showImportant}
                  onCheckedChange={setShowImportant}
                >
                  Important
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={showStarred} onCheckedChange={setShowStarred}>
                  Starred
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
            placeholder="Search emails..."
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
            <Combobox multiple value={filters} onValueChange={setFilters} items={FILTER_OPTIONS}>
              <ComboboxChips ref={filterAnchor} className="min-h-8 text-xs">
                {filters.map((v) => (
                  <ComboboxChip key={v}>{FILTER_LABEL_MAP[v] || v}</ComboboxChip>
                ))}
                <ComboboxChipsInput
                  placeholder={filters.length === 0 ? "Filter..." : ""}
                  className="text-xs"
                />
              </ComboboxChips>
              <ComboboxContent anchor={filterAnchor}>
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
              value={selectedLabels}
              onValueChange={setSelectedLabels}
              items={labelNames}
            >
              <ComboboxChips ref={labelAnchor} className="min-h-8 text-xs">
                {selectedLabels.map((v) => (
                  <ComboboxChip key={v}>{v}</ComboboxChip>
                ))}
                <ComboboxChipsInput
                  placeholder={selectedLabels.length === 0 ? "Labels..." : ""}
                  className="text-xs"
                />
              </ComboboxChips>
              <ComboboxContent anchor={labelAnchor}>
                <ComboboxList>
                  {(item) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
                <ComboboxEmpty>No labels found</ComboboxEmpty>
              </ComboboxContent>
            </Combobox>
          </>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
        {loading && <ListSkeleton itemHeight={88} />}
        {error && <div className="p-3 text-sm text-destructive">{error}</div>}
        {!loading && threads.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const msg = threads[virtualRow.index]
              const badges: ListItemBadge[] = []
              if (showReadStatus && msg.isUnread) {
                badges.push({ label: "Unread", variant: "secondary" })
              }
              if (showImportant && msg.labelIds.includes("IMPORTANT")) {
                badges.push({
                  label: "Important",
                  variant: "outline",
                  className: "bg-chart-2/20 text-chart-2 border-chart-2/30",
                })
              }
              if (showStarred && msg.labelIds.includes("STARRED")) {
                badges.push({
                  label: "Starred",
                  variant: "outline",
                  className: "bg-primary/20 text-primary border-primary/30",
                })
              }
              if (showLabels) {
                const userLabels = msg.labelIds.filter(
                  (id) =>
                    !id.startsWith("CATEGORY_") &&
                    ![
                      "INBOX",
                      "IMPORTANT",
                      "STARRED",
                      "UNREAD",
                      "SENT",
                      "DRAFT",
                      "TRASH",
                      "SPAM",
                    ].includes(id),
                )
                for (const label of userLabels.slice(0, 3)) {
                  const l = labels.find((lb) => lb.id === label)
                  badges.push({ label: l?.name || label, variant: "outline" })
                }
              }
              return (
                <div
                  key={msg.id}
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
                    title={formatEmailAddress(msg.from)}
                    subtitle={msg.subject}
                    timestamp={formatRelativeDate(msg.date)}
                    badges={badges}
                    isSelected={selectedThreadId === msg.threadId}
                    onClick={() => navigate(`/emails/${msg.threadId}`)}
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
        {!loading && threads.length === 0 && !error && (
          <EmptyState icon={Mail} message="No emails found" />
        )}
      </div>
    </div>
  )
}
