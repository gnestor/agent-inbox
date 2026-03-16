import { useRef, useMemo, useState, useDeferredValue } from "react"
import { useVirtualizerSafe } from "@/hooks/use-virtualizer-safe"
import { ListItem, type ListItemBadge } from "./ListItem"
import { PanelHeader, SidebarButton } from "./PanelHeader"
import { SearchInput } from "./SearchInput"
import { FilterPopover } from "./FilterPopover"
import { ListSkeleton } from "./ListSkeleton"
import { EmptyState } from "./EmptyState"
import { Bot } from "lucide-react"
import type { FieldDef } from "@/types/plugin"
import {
  getTitleField,
  getSubtitleField,
  getTimestampField,
  getBadgeFields,
  extractFieldValue,
} from "@/lib/field-schema"
import { formatRelativeDate, truncate } from "@/lib/formatters"

interface ListViewProps<T extends Record<string, unknown>> {
  title: string
  icon?: React.ReactNode
  items: T[]
  loading?: boolean
  error?: string | null
  fieldSchema: FieldDef[]
  getItemId: (item: T) => string
  selectedId?: string
  onSelect: (id: string, index: number) => void
  itemHeight?: number
  searchPlaceholder?: string
  onSearch?: (query: string) => void
  localSearch?: (item: T, query: string) => boolean
  hasMore?: boolean
  loadMore?: () => void
  headerRight?: React.ReactNode
  activeFilters?: Record<string, string>
  onFilterChange?: (key: string, value: string) => void
}

export function ListView<T extends Record<string, unknown>>({
  title,
  icon: _icon,
  items,
  loading,
  error,
  fieldSchema,
  getItemId,
  selectedId,
  onSelect,
  itemHeight = 76,
  searchPlaceholder,
  onSearch,
  localSearch,
  hasMore: _hasMore,
  loadMore: _loadMore,
  headerRight,
  activeFilters = {},
  onFilterChange,
}: ListViewProps<T>) {
  const [search, setSearch] = useState("")
  const deferredSearch = useDeferredValue(search)

  // Schema-derived field extractors
  const titleField = useMemo(() => getTitleField(fieldSchema), [fieldSchema])
  const subtitleField = useMemo(() => getSubtitleField(fieldSchema), [fieldSchema])
  const timestampField = useMemo(() => getTimestampField(fieldSchema), [fieldSchema])
  const badgeFields = useMemo(() => getBadgeFields(fieldSchema), [fieldSchema])

  // Handle search
  function handleSearch(value: string) {
    setSearch(value)
    onSearch?.(value)
  }

  // Client-side filtering
  const filteredItems = useMemo(() => {
    if (!localSearch || !deferredSearch) return items
    return items.filter((item) => localSearch(item, deferredSearch))
  }, [items, deferredSearch, localSearch])

  // Virtualizer
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizerSafe({
    count: filteredItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => itemHeight,
    getItemKey: (index) => getItemId(filteredItems[index]) ?? index,
    overscan: 5,
  })

  // Build badges for an item from schema
  function buildBadges(item: T): ListItemBadge[] {
    const badges: ListItemBadge[] = []
    for (const field of badgeFields) {
      const value = extractFieldValue(item, field.id)
      if (field.badge?.show === "if-set" && !value) continue
      if (value === undefined || value === null) continue

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
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        left={
          <>
            <SidebarButton />
            <h2 className="font-semibold text-sm">{title}</h2>
          </>
        }
        right={
          <>
            {onFilterChange && (
              <FilterPopover
                fieldSchema={fieldSchema}
                activeFilters={activeFilters}
                onFilterChange={onFilterChange}
              />
            )}
            {headerRight}
          </>
        }
      />
      <SearchInput
        value={search}
        onChange={handleSearch}
        placeholder={searchPlaceholder ?? `Search ${title.toLowerCase()}...`}
      />
      <div ref={scrollRef} className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
        {loading && <ListSkeleton itemHeight={itemHeight} />}
        {error && <div className="p-3 text-sm text-destructive">{error}</div>}
        {!loading && filteredItems.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = filteredItems[virtualRow.index]
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
        {!loading && filteredItems.length === 0 && !error && (
          <EmptyState icon={Bot} message={`No ${title.toLowerCase()} found`} />
        )}
      </div>
    </div>
  )
}
