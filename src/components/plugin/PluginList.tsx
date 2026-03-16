import { useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useVirtualizerSafe } from "@/hooks/use-virtualizer-safe"
import { Plug, SlidersHorizontal } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent } from "@hammies/frontend/components/ui"
import { usePlugins, usePluginItems } from "@/hooks/use-plugins"
import { ListItem } from "@/components/shared/ListItem"
import type { ListItemBadge } from "@/components/shared/ListItem"
import { EmptyState } from "@/components/shared/EmptyState"
import { ListSkeleton } from "@/components/shared/ListSkeleton"
import { PanelHeader, SidebarButton } from "@/components/shared/PanelHeader"
import { FilterCombobox } from "@/components/shared/FilterCombobox"
import { usePreference } from "@/hooks/use-preferences"
import type { PluginManifest } from "@/api/client"
import type { PluginItem, FieldDef } from "@/types/plugin"

function buildBadges(item: PluginItem, fieldSchema: FieldDef[]): ListItemBadge[] {
  if (item.badges) return item.badges as ListItemBadge[]
  const badges: ListItemBadge[] = []
  for (const field of fieldSchema) {
    if (!field.badge) continue
    const raw = item[field.id]
    if (raw == null) continue
    const value = String(raw)
    if (field.badge.show === "if-set" && !raw) continue
    badges.push({
      label: value,
      variant: field.badge.variant,
      className: field.badge.colorFn?.(value),
    })
  }
  return badges
}

function getItemTitle(item: PluginItem): string {
  for (const key of ["title", "name", "subject", "channelName", "text", "summary"]) {
    if (typeof item[key] === "string" && item[key]) return item[key] as string
  }
  return item.id
}

function getItemSubtitle(item: PluginItem): string | undefined {
  for (const key of ["subtitle", "description", "latestText", "preview"]) {
    if (typeof item[key] === "string" && item[key]) return item[key] as string
  }
  return undefined
}

function getItemTimestamp(item: PluginItem): string {
  for (const key of ["latestTs", "updatedAt", "createdAt", "timestamp", "date", "ts"]) {
    const val = item[key]
    if (!val) continue
    if (typeof val === "number") return new Date(val * 1000).toLocaleDateString()
    if (typeof val === "string") {
      const n = parseFloat(val)
      if (!isNaN(n) && val.includes(".")) return new Date(n * 1000).toLocaleDateString()
      return new Date(val).toLocaleDateString()
    }
  }
  return ""
}

interface PluginListInnerProps {
  plugin: PluginManifest
  selectedItemId?: string
  onSelectedIndexChange?: (index: number) => void
  onSelectedTitleChange?: (title: string) => void
}

function PluginListInner({
  plugin,
  selectedItemId,
  onSelectedIndexChange,
  onSelectedTitleChange,
}: PluginListInnerProps) {
  const navigate = useNavigate()

  // Persist filter state per plugin via user preferences
  const [filterState, setFilterState] = usePreference<Record<string, string[]>>(
    `plugin:${plugin.id}.filters`,
    {},
  )

  const filterableFields = plugin.fieldSchema.filter((f) => f.filter?.filterable)

  // Convert string[] per field → comma-joined string for the API query
  const queryFilters: Record<string, string> = {}
  for (const [k, v] of Object.entries(filterState)) {
    if (v.length > 0) queryFilters[k] = v.join(",")
  }

  const hasActiveFilters = Object.values(filterState).some((v) => v.length > 0)

  const { data, isLoading } = usePluginItems(plugin.id, queryFilters)
  const items = data?.items ?? []

  const containerRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizerSafe({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 72,
    getItemKey: (index) => items[index]?.id ?? index,
    overscan: 5,
  })

  const filterUI = filterableFields.length > 0 ? (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={`shrink-0 p-1.5 rounded-md hover:bg-accent ${hasActiveFilters ? "text-sidebar-primary" : "text-muted-foreground"}`}
            title="Filters"
          />
        }
      >
        <SlidersHorizontal className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 space-y-1.5">
        {filterableFields.map((field) => {
          const options = (field.filter?.filterOptions ?? []) as string[]
          return (
            <FilterCombobox
              key={field.id}
              placeholder={`${field.label}...`}
              items={options}
              value={filterState[field.id] ?? []}
              onValueChange={(vals) =>
                setFilterState({ ...filterState, [field.id]: vals })
              }
            />
          )
        })}
      </PopoverContent>
    </Popover>
  ) : null

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <PanelHeader
        left={
          <div className="flex items-center gap-2">
            <SidebarButton />
            <span className="font-semibold text-sm">{plugin.name}</span>
          </div>
        }
        right={filterUI}
      />

      {isLoading && !items.length && <ListSkeleton itemHeight={72} />}

      {!isLoading && !items.length && (
        <EmptyState icon={Plug} message={`No ${plugin.name} items`} />
      )}

      {items.length > 0 && (
        <div ref={containerRef} className="flex-1 overflow-y-auto">
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index]
              const title = getItemTitle(item)
              const badges = buildBadges(item, plugin.fieldSchema)

              return (
                <div
                  key={item.id}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ListItem
                    title={title}
                    subtitle={getItemSubtitle(item)}
                    timestamp={getItemTimestamp(item)}
                    badges={badges}
                    isSelected={selectedItemId === item.id}
                    onClick={() => {
                      if (onSelectedIndexChange) onSelectedIndexChange(virtualRow.index)
                      if (onSelectedTitleChange) onSelectedTitleChange(title)
                      navigate(`/plugins/${plugin.id}/${item.id}`)
                    }}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export function PluginList({
  selectedItemId,
  onSelectedIndexChange,
  onSelectedTitleChange,
}: {
  selectedItemId?: string
  onSelectedIndexChange?: (index: number) => void
  onSelectedTitleChange?: (title: string) => void
}) {
  const { id } = useParams<{ id: string }>()
  const { data: plugins, isLoading } = usePlugins()
  const plugin = plugins?.find((p) => p.id === id)

  if (isLoading) return <ListSkeleton itemHeight={72} />
  if (!plugin) {
    return (
      <EmptyState
        icon={Plug}
        message={id ? `Plugin "${id}" not found` : "Select a plugin"}
      />
    )
  }

  return (
    <PluginListInner
      plugin={plugin}
      selectedItemId={selectedItemId}
      onSelectedIndexChange={onSelectedIndexChange}
      onSelectedTitleChange={onSelectedTitleChange}
    />
  )
}
