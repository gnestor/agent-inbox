/**
 * Properties popover for Notion-backed plugin items.
 * Shows editable Status, Priority, Tags, and read-only Assignee/Date/Updated fields.
 * Uses the generic plugin filterOptions API for select options and mutatePluginItem for updates.
 */
import { useQuery } from "@tanstack/react-query"
import {
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@hammies/frontend/components/ui"
import { SlidersHorizontal } from "lucide-react"
import { PropertySelect, PropertyMultiSelect } from "@/components/shared/PropertyEditor"
import { getFieldOptions } from "@/api/client"
import { useWorkspaceId } from "@/hooks/use-user"
import { usePluginMutations } from "@/hooks/use-plugin-mutations"
import { formatRelativeDate } from "@/lib/formatters"

interface PropertiesPopoverProps {
  pluginId: string
  itemId: string
  item: Record<string, unknown>
}

export function PropertiesPopover({ pluginId, itemId, item }: PropertiesPopoverProps) {
  const wsId = useWorkspaceId()
  const { mutate } = usePluginMutations(pluginId, itemId)

  const { data: statusOpts } = useQuery({
    queryKey: ["plugin-field-options", wsId, pluginId, "status"],
    queryFn: () => getFieldOptions(pluginId, "status").then((r) => r.options.map((o) => ({ value: o, color: null }))),
  })

  const { data: priorityOpts } = useQuery({
    queryKey: ["plugin-field-options", wsId, pluginId, "priority"],
    queryFn: () => getFieldOptions(pluginId, "priority").then((r) => r.options.map((o) => ({ value: o, color: null }))),
    enabled: item.priority !== undefined,
  })

  const { data: tagOpts } = useQuery({
    queryKey: ["plugin-field-options", wsId, pluginId, "tags"],
    queryFn: () => getFieldOptions(pluginId, "tags").then((r) => r.options.map((o) => ({ value: o, color: null }))),
  })

  const status = item.status as string | undefined
  const priority = item.priority as string | undefined
  const tags = item.tags as string[] | undefined
  const assignee = item.assignee as string | undefined
  const date = item.date as string | undefined
  const updatedAt = item.updatedAt as string | undefined

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            title="Properties"
          />
        }
      >
        <SlidersHorizontal className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-4 gap-0">
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
          {date !== undefined && (
            <>
              <label className="text-sm font-medium">Date</label>
              <div className="text-sm py-1">{date ? new Date(date).toLocaleDateString() : "—"}</div>
            </>
          )}
          {status !== undefined && (
            <>
              <label className="text-sm font-medium">Status</label>
              <PropertySelect
                value={status}
                options={statusOpts ?? []}
                onChange={(v) => mutate("update-status", { status: v })}
                loading={false}
              />
            </>
          )}
          {priority !== undefined && (
            <>
              <label className="text-sm font-medium">Priority</label>
              <PropertySelect
                value={priority}
                options={priorityOpts ?? []}
                onChange={(v) => mutate("update-properties", { Priority: { select: { name: v } } })}
                loading={false}
              />
            </>
          )}
          {tags !== undefined && (
            <>
              <label className="text-sm font-medium self-start pt-1.5">Tags</label>
              <PropertyMultiSelect
                value={tags}
                options={tagOpts ?? []}
                onChange={(v) => mutate("update-tags", { tags: v })}
                loading={false}
                placeholder="Add tag..."
              />
            </>
          )}
          {assignee && (
            <>
              <label className="text-sm font-medium">Assignee</label>
              <div className="text-sm py-1">{assignee}</div>
            </>
          )}
          {updatedAt && (
            <>
              <label className="text-sm font-medium">Updated</label>
              <div className="text-sm py-1">{formatRelativeDate(updatedAt)}</div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
