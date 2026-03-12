import { useState, useRef } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Plug } from "lucide-react"
import { usePlugins, usePluginItems } from "@/hooks/use-plugins"
import { ListItem } from "@/components/shared/ListItem"
import type { ListItemBadge } from "@/components/shared/ListItem"
import { EmptyState } from "@/components/shared/EmptyState"
import { ListSkeleton } from "@/components/shared/ListSkeleton"
import { PanelHeader, SidebarButton } from "@/components/shared/PanelHeader"
import { FilterCombobox } from "@/components/shared/FilterCombobox"
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
    if (field.badge.show === "if-set" && !value) continue
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
  for (const key of ["latestTs", "updatedAt", "createdAt", "timestamp", "date"]) {
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
  const [filters, setFilters] = useState<Record<string, string>>({})

  const { data, isLoading } = usePluginItems(plugin.id, filters)
  const items = data?.items ?? []

  const filterableFields = plugin.fieldSchema.filter((f) => f.filter?.filterable)

  const containerRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 72,
    overscan: 5,
  })

  const filterUI = filterableFields.length > 0 ? (
    <div className="flex gap-1 flex-wrap">
      {filterableFields.map((field) => {
        const options = (field.filter?.filterOptions ?? []) as string[]
        return (
          <FilterCombobox
            key={field.id}
            placeholder={field.label}
            items={options}
            value={filters[field.id] ? filters[field.id].split(",") : []}
            onValueChange={(vals) =>
              setFilters((prev) => {
                const next = { ...prev }
                if (vals.length > 0) next[field.id] = vals.join(",")
                else delete next[field.id]
                return next
              })
            }
          />
        )
      })}
    </div>
  ) : null

  return (
    <div className="flex flex-col h-full">
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
