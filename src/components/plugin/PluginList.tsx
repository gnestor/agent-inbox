import { useRef, useMemo } from "react"
import { useIsRestoring } from "@tanstack/react-query"
import { useVirtualizerSafe } from "@/hooks/use-virtualizer-safe"
import { SlidersHorizontal } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent } from "@hammies/frontend/components/ui"
import { usePlugins, usePluginItems } from "@/hooks/use-plugins"
import { ListItem } from "@/components/shared/ListItem"
import type { ListItemBadge } from "@/components/shared/ListItem"
import { ListSkeleton } from "@/components/shared/ListSkeleton"
import { PanelHeader, SidebarButton } from "@/components/shared/PanelHeader"
import { FilterCombobox } from "@/components/shared/FilterCombobox"
import { BadgeToggleMenu } from "@/components/shared/BadgeToggleMenu"
import { usePreference } from "@/hooks/use-preferences"
import { useNavigation } from "@/hooks/use-navigation"
import { getItemTitle, getItemSubtitle, getItemTimestamp } from "@/lib/plugin-utils"
import type { PluginManifest } from "@/api/client"
import type { PluginItem, FieldDef } from "@/types/plugin"

function buildBadges(item: PluginItem, fieldSchema: FieldDef[], hiddenFields?: Set<string>): ListItemBadge[] {
  if (item.badges) return item.badges as ListItemBadge[]
  const badges: ListItemBadge[] = []
  for (const field of fieldSchema) {
    if (!field.badge) continue
    if (hiddenFields?.has(field.id)) continue
    const raw = item[field.id]
    if (raw == null) continue
    const value = String(raw)
    if (field.badge.show === "if-set" && !raw) continue
    const label = field.badge.labelFn?.(value) ?? value
    if (!label) continue
    badges.push({
      label,
      variant: field.badge.variant,
      className: field.badge.colorFn?.(value),
    })
  }
  return badges
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
  const { selectItem } = useNavigation()

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

  // Badge visibility preferences per plugin
  const badgeFields = plugin.fieldSchema.filter((f) => f.badge)
  const [hiddenBadges, setHiddenBadges] = usePreference<string[]>(
    `plugin:${plugin.id}.hiddenBadges`,
    [],
  )
  const hiddenBadgeFields = useMemo(() => new Set(hiddenBadges), [hiddenBadges])
  const badgeToggleItems = badgeFields.map((f) => ({
    label: f.label,
    checked: !hiddenBadgeFields.has(f.id),
    onChange: (checked: boolean) => {
      if (checked) {
        setHiddenBadges(hiddenBadges.filter((id) => id !== f.id))
      } else {
        setHiddenBadges([...hiddenBadges, f.id])
      }
    },
  }))

  const isRestoring = useIsRestoring()
  const { data, isLoading: queryLoading } = usePluginItems(plugin.id, queryFilters)
  const isLoading = queryLoading || isRestoring
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
            className={`shrink-0 p-1.5 rounded-md hover:bg-secondary ${hasActiveFilters ? "text-sidebar-primary" : "text-muted-foreground"}`}
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
        right={
          <>
            {filterUI}
            {badgeToggleItems.length > 0 && <BadgeToggleMenu items={badgeToggleItems} />}
          </>
        }
      />

      {isLoading && !items.length && <ListSkeleton itemHeight={72} />}

      {!isLoading && !items.length && (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          No {plugin.name} items
        </div>
      )}

      {items.length > 0 && (
        <div ref={containerRef} className="flex-1 overflow-y-auto">
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index]
              const title = getItemTitle(item)
              const badges = buildBadges(item, plugin.fieldSchema, hiddenBadgeFields)

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
                      selectItem(item.id, virtualRow.index)
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
  pluginId,
  selectedItemId,
  onSelectedIndexChange,
  onSelectedTitleChange,
}: {
  pluginId?: string
  selectedItemId?: string
  onSelectedIndexChange?: (index: number) => void
  onSelectedTitleChange?: (title: string) => void
}) {
  const { data: plugins, isLoading } = usePlugins()
  const plugin = plugins?.find((p) => p.id === pluginId)

  if (isLoading || (pluginId && !plugin)) return <ListSkeleton itemHeight={72} />
  if (!plugin) return null

  return (
    <PluginListInner
      plugin={plugin}
      selectedItemId={selectedItemId}
      onSelectedIndexChange={onSelectedIndexChange}
      onSelectedTitleChange={onSelectedTitleChange}
    />
  )
}
