import { createContext, useContext, useRef, useMemo, useCallback, useState } from "react"
import { useVirtualizerSafe } from "@/hooks/use-virtualizer-safe"
import { useVirtualInfiniteScroll } from "@/hooks/use-infinite-scroll"
import { ListItem, type ListItemBadge } from "./ListItem"
import { PanelHeader, SidebarButton } from "./PanelHeader"
import { SearchInput } from "./SearchInput"
import { FilterPopover } from "./FilterPopover"
import { ListSkeleton } from "./ListSkeleton"
import { EmptyState } from "./EmptyState"
import { Bot, Loader2 } from "lucide-react"
import type { FieldDef } from "@/types/plugin"
import {
  getTitleField,
  getSubtitleField,
  getTimestampField,
  getBadgeFields,
  extractFieldValue,
} from "@/lib/field-schema"
import { formatRelativeDate, truncate } from "@/lib/formatters"

const NOOP = () => {}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ListViewContextValue {
  items: Record<string, unknown>[]
  fieldSchema: FieldDef[]
  getItemId: (item: Record<string, unknown>) => string
  selectedId?: string
  onSelect: (id: string, index: number) => void
}

const ListViewContext = createContext<ListViewContextValue | null>(null)

function useListViewContext() {
  const ctx = useContext(ListViewContext)
  if (!ctx) throw new Error("ListView sub-components must be used inside <ListView>")
  return ctx
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

interface ListViewRootProps<T extends Record<string, unknown>> {
  items: T[]
  fieldSchema: FieldDef[]
  getItemId: (item: T) => string
  selectedId?: string
  onSelect: (id: string, index: number) => void
  children: React.ReactNode
}

function ListViewRoot<T extends Record<string, unknown>>({
  items,
  fieldSchema,
  getItemId,
  selectedId,
  onSelect,
  children,
}: ListViewRootProps<T>) {
  const ctx = useMemo(
    () => ({
      items: items as Record<string, unknown>[],
      fieldSchema,
      getItemId: getItemId as (item: Record<string, unknown>) => string,
      selectedId,
      onSelect,
    }),
    [items, fieldSchema, getItemId, selectedId, onSelect],
  )

  return (
    <ListViewContext.Provider value={ctx}>
      <div className="flex flex-col h-full">{children}</div>
    </ListViewContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function ListViewHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <PanelHeader
      left={
        <>
          <SidebarButton />
          <h2 className="font-semibold text-sm">{title}</h2>
        </>
      }
      right={children}
    />
  )
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface ListViewSearchProps {
  placeholder?: string
  onSearch?: (query: string) => void
}

function ListViewSearch({ placeholder, onSearch }: ListViewSearchProps) {
  const [value, setValue] = useState("")

  function handleSearch(v: string) {
    setValue(v)
    onSearch?.(v)
  }

  return (
    <SearchInput
      value={value}
      onChange={handleSearch}
      placeholder={placeholder ?? "Search..."}
    />
  )
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

interface ListViewFiltersProps {
  activeFilters: Record<string, string>
  onFilterChange: (key: string, value: string) => void
  optionsFetcher?: Record<string, () => Promise<string[]>>
}

function ListViewFilters({ activeFilters, onFilterChange, optionsFetcher }: ListViewFiltersProps) {
  const { fieldSchema } = useListViewContext()
  return (
    <FilterPopover
      fieldSchema={fieldSchema}
      activeFilters={activeFilters}
      onFilterChange={onFilterChange}
      optionsFetcher={optionsFetcher}
    />
  )
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

interface ListViewBodyProps {
  itemHeight?: number
  loading?: boolean
  error?: string | null
  errorContent?: React.ReactNode
  hasMore?: boolean
  loadMore?: () => void
  hiddenBadgeFields?: Set<string>
  emptyIcon?: React.ComponentType<{ className?: string }>
  emptyMessage?: string
}

function ListViewBody({
  itemHeight = 88,
  loading,
  error,
  errorContent,
  hasMore,
  loadMore,
  hiddenBadgeFields,
  emptyIcon = Bot,
  emptyMessage,
}: ListViewBodyProps) {
  const { items, fieldSchema, getItemId, selectedId, onSelect } = useListViewContext()

  const titleField = useMemo(() => getTitleField(fieldSchema), [fieldSchema])
  const subtitleField = useMemo(() => getSubtitleField(fieldSchema), [fieldSchema])
  const timestampField = useMemo(() => getTimestampField(fieldSchema), [fieldSchema])
  const badgeFields = useMemo(() => getBadgeFields(fieldSchema), [fieldSchema])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizerSafe({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => itemHeight,
    getItemKey: (index) => getItemId(items[index]) ?? index,
    overscan: 5,
  })

  useVirtualInfiniteScroll(virtualizer, loadMore ?? NOOP, hasMore ?? false, !!loading)

  const buildBadges = useCallback((item: Record<string, unknown>): ListItemBadge[] => {
    const badges: ListItemBadge[] = []
    for (const field of badgeFields) {
      if (hiddenBadgeFields?.has(field.id)) continue
      const value = extractFieldValue(item, field.id)
      if (field.badge?.show === "if-set" && !value) continue
      if (value === undefined || value === null) continue

      if (field.type === "boolean") {
        if (value) {
          const className = field.badge?.colorFn?.(field.label)
          badges.push({
            label: field.label,
            variant: field.badge?.variant ?? "secondary",
            className,
          })
        }
        continue
      }

      const values = Array.isArray(value) ? value : [value]
      for (const v of values) {
        const label = String(v)
        const className = field.badge?.colorFn?.(label)
        badges.push({
          label,
          variant: field.badge?.variant ?? "secondary",
          className,
        })
      }
    }
    return badges
  }, [badgeFields, hiddenBadgeFields])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
      {loading && <ListSkeleton itemHeight={itemHeight} />}
      {error && (errorContent || <div className="p-3 text-sm text-destructive">{error}</div>)}
      {!loading && items.length > 0 && (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index]
            const id = getItemId(item)

            const itemTitle = titleField
              ? String(extractFieldValue(item, titleField.id) ?? "")
              : truncate(String(item.id ?? ""), 60)
            const subtitle = subtitleField
              ? String(extractFieldValue(item, subtitleField.id) ?? "")
              : undefined
            const timestamp = timestampField
              ? formatRelativeDate(String(extractFieldValue(item, timestampField.id) ?? ""))
              : ""

            return (
              <div
                key={id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${itemHeight}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <ListItem
                  title={itemTitle}
                  subtitle={subtitle}
                  timestamp={timestamp}
                  badges={buildBadges(item)}
                  isSelected={selectedId === id}
                  onClick={() => onSelect(id, virtualRow.index)}
                />
              </div>
            )
          })}
        </div>
      )}
      {hasMore && !loading && (
        <div className="flex justify-center p-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {!loading && items.length === 0 && !error && (
        <EmptyState icon={emptyIcon} message={emptyMessage ?? "No items found"} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compound export
// ---------------------------------------------------------------------------

export const ListView = Object.assign(ListViewRoot, {
  Header: ListViewHeader,
  Search: ListViewSearch,
  Filters: ListViewFilters,
  Body: ListViewBody,
})
