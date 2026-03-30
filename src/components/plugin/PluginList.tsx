import { useRef, useMemo, useState } from "react"
import { useIsRestoring, useQuery } from "@tanstack/react-query"
import { useVirtualizerSafe } from "@/hooks/use-virtualizer-safe"
import { SlidersHorizontal, Search } from "lucide-react"
import {
  Popover, PopoverTrigger, PopoverContent,
  Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty,
  ComboboxCollection, ComboboxGroup, ComboboxLabel, ComboboxSeparator,
} from "@hammies/frontend/components/ui"
import { usePlugins, usePluginItems } from "@/hooks/use-plugins"
import { getFieldOptions } from "@/api/client"
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
    if (field.badge.show === "if-set" && !raw) continue

    // Boolean fields: use field label as badge text (not "true")
    if (field.type === "boolean") {
      const label = field.badge.labelFn?.(String(raw)) ?? field.label
      badges.push({ label, variant: field.badge.variant, className: field.badge.colorFn?.(String(raw)) })
      continue
    }

    // Split comma-separated values into individual badges (e.g. tags)
    const values = String(raw).includes(",") ? String(raw).split(",").map((s) => s.trim()) : [String(raw)]
    for (const value of values) {
      const label = field.badge.labelFn?.(value) ?? value
      if (!label) continue
      badges.push({
        label,
        variant: field.badge.variant,
        className: field.badge.colorFn?.(value),
      })
    }
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
  const [searchQuery, setSearchQuery] = useState("")

  // Persist filter state per plugin via user preferences
  const [filterState, setFilterState] = usePreference<Record<string, string[]>>(
    `plugin:${plugin.id}.filters`,
    {},
  )

  const filterableFields = plugin.fieldSchema.filter((f) => f.filter?.filterable)

  // Fetch dynamic filter options for fields that don't define static filterOptions
  type ViewGroupItem = { value: string; label: string }
  type ViewGroup = { value: string; items: ViewGroupItem[] }
  const dynamicFieldIds = useMemo(
    () =>
      plugin.hasFilterOptions
        ? filterableFields
            .filter((f) => !f.filter?.filterOptions?.length)
            .map((f) => f.id)
        : [],
    [plugin.hasFilterOptions, filterableFields],
  )
  const { data: dynamicOptions } = useQuery({
    queryKey: ["plugin-field-options", plugin.id, dynamicFieldIds],
    queryFn: async () => {
      const results: Record<string, string[]> = {}
      await Promise.all(
        dynamicFieldIds.map(async (fieldId) => {
          try {
            const { options } = await getFieldOptions(plugin.id, fieldId)
            results[fieldId] = options
          } catch { /* ignore */ }
        }),
      )
      return results
    },
    enabled: dynamicFieldIds.length > 0,
    staleTime: 60_000,
  })

  // Parse grouped view options from __group__: markers in dynamicOptions
  // Items before the first __group__ marker are ungrouped (rendered as flat items before groups)
  const viewParsed = useMemo<{ ungrouped: ViewGroupItem[]; groups: ViewGroup[] } | null>(() => {
    const raw = dynamicOptions?.["viewName"]
    if (!raw?.some((s) => s.startsWith("__group__:"))) return null
    const ungrouped: ViewGroupItem[] = []
    const groups: ViewGroup[] = []
    for (const item of raw) {
      if (item.startsWith("__group__:")) {
        groups.push({ value: item.slice("__group__:".length), items: [] })
      } else if (groups.length > 0) {
        groups[groups.length - 1].items.push({ value: item, label: item })
      } else {
        ungrouped.push({ value: item, label: item })
      }
    }
    return groups.length > 0 || ungrouped.length > 0 ? { ungrouped, groups } : null
  }, [dynamicOptions])

  // Convert string[] per field → comma-joined string for the API query
  const queryFilters: Record<string, string> = {}
  for (const [k, v] of Object.entries(filterState)) {
    if (v.length > 0) queryFilters[k] = v.join(",")
  }
  if (searchQuery.trim()) queryFilters.q = searchQuery.trim()

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
          const options = (field.filter?.filterOptions as string[] | undefined)?.length
            ? (field.filter!.filterOptions as string[])
            : (dynamicOptions?.[field.id] ?? [])

          if (field.filter?.filterType === "select") {
            const current = filterState[field.id]?.[0] ?? null
            // Grouped combobox (view selector with sections)
            if (field.id === "viewName" && viewParsed && (viewParsed.groups.length > 0 || viewParsed.ungrouped.length > 0)) {
              // Build items array: ungrouped items as a labelless group, then labeled groups
              const allGroups: ViewGroup[] = []
              if (viewParsed.ungrouped.length > 0) {
                allGroups.push({ value: "__ungrouped__", items: viewParsed.ungrouped })
              }
              allGroups.push(...viewParsed.groups)

              return (
                <Combobox
                  key={`${field.id}:grouped`}
                  value={current}
                  onValueChange={(val) =>
                    setFilterState({ ...filterState, [field.id]: val ? [val as string] : [] })
                  }
                  items={allGroups}
                >
                  <ComboboxInput
                    placeholder={`${field.label}...`}
                    className="text-xs"
                    showClear={!!current}
                  />
                  <ComboboxContent>
                    <ComboboxEmpty>No matches</ComboboxEmpty>
                    <ComboboxList>
                      {(group: ViewGroup, index: number) => (
                        <ComboboxGroup key={group.value} items={group.items}>
                          {group.value !== "__ungrouped__" && (
                            <>
                              {index > 0 && <ComboboxSeparator />}
                              <ComboboxLabel>{group.value}</ComboboxLabel>
                            </>
                          )}
                          <ComboboxCollection>
                            {(item: ViewGroupItem) => (
                              <ComboboxItem key={item.value} value={item.value}>
                                {item.label}
                              </ComboboxItem>
                            )}
                          </ComboboxCollection>
                        </ComboboxGroup>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              )
            }

            // Flat combobox (fallback or non-view select fields)
            return (
              <Combobox
                key={field.id}
                value={current}
                onValueChange={(val) =>
                  setFilterState({ ...filterState, [field.id]: val ? [val as string] : [] })
                }
                items={options}
              >
                <ComboboxInput
                  placeholder={`${field.label}...`}
                  className="text-xs"
                  showClear={!!current}
                />
                <ComboboxContent>
                  <ComboboxEmpty>No matches</ComboboxEmpty>
                  <ComboboxList>
                    {(item: string) => (
                      <ComboboxItem key={item} value={item}>
                        {item}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            )
          }

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

      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={`Search ${plugin.name.toLowerCase()}...`}
          className="flex-1 text-xs bg-transparent border-0 outline-none placeholder:text-muted-foreground"
        />
      </div>

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
