import { useNavigation } from "@/hooks/use-navigation"
import { useQuery } from "@tanstack/react-query"
import {
  ScrollArea,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@hammies/frontend/components/ui"
import { ExternalLink, SlidersHorizontal } from "lucide-react"
import { getCalendarItem, getLinkedSession, getNotionOptions } from "@/api/client"
import { formatRelativeDate } from "@/lib/formatters"
import { useCalendarMutation } from "@/hooks/use-calendar-mutation"
import { SessionActionMenu } from "@/components/session/AttachToSessionMenu"
import { PanelHeader, BackButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { PropertySelect, PropertyMultiSelect, PropertyDate } from "@/components/shared/PropertyEditor"
import { NotionBlockRenderer } from "./NotionBlockRenderer"

interface CalendarDetailProps {
  itemId: string
  title?: string
  sessionOpen?: boolean
}

export function CalendarDetail({ itemId, title, sessionOpen }: CalendarDetailProps) {
  const { deselectItem } = useNavigation()
  const { data: item, isLoading: loading, error: queryError } = useQuery({
    queryKey: ["calendar-item", itemId],
    queryFn: () => getCalendarItem(itemId),
  })
  const { data: linkedData } = useQuery({
    queryKey: ["linked-session", "calendar", itemId],
    queryFn: () => getLinkedSession(undefined, itemId),
  })
  const { data: statusOpts } = useQuery({
    queryKey: ["notion-options", "calendar:Status"],
    queryFn: () => getNotionOptions("calendar:Status"),
  })
  const { data: tagOpts } = useQuery({
    queryKey: ["notion-options", "calendar:Tags"],
    queryFn: () => getNotionOptions("calendar:Tags"),
  })
  const linkedSession = linkedData?.session
  const error = queryError?.message ?? null
  const mutation = useCalendarMutation(itemId)

  const date = item?.properties?.["Date"]?.date?.start

  const header = (
    <PanelHeader
      left={
        <>
          <BackButton onClick={() => deselectItem()} />
          <h2 className="font-semibold text-sm truncate">{title}</h2>
        </>
      }
      right={
        <>
          {item && (
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className="shrink-0 p-1.5 rounded-md hover:bg-accent text-muted-foreground"
                    title="Properties"
                  />
                }
              >
                <SlidersHorizontal className="h-4 w-4" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-4 gap-0">
                <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
                  <label className="text-sm font-medium">Date</label>
                  <PropertyDate
                    value={date}
                    onChange={mutation.updateDate}
                    loading={mutation.isPending}
                  />
                  <label className="text-sm font-medium">Status</label>
                  <PropertySelect
                    value={item.status}
                    options={statusOpts?.options ?? []}
                    onChange={mutation.updateStatus}
                    loading={mutation.isPending}
                  />
                  <label className="text-sm font-medium self-start pt-1.5">Tags</label>
                  <PropertyMultiSelect
                    value={item.tags}
                    options={tagOpts?.options ?? []}
                    onChange={mutation.updateTags}
                    loading={mutation.isPending}
                    placeholder="Add tag..."
                  />
                  {item.assignee && (
                    <>
                      <label className="text-sm font-medium">Assignee</label>
                      <div className="text-sm py-1">{item.assignee}</div>
                    </>
                  )}
                  <label className="text-sm font-medium">Updated</label>
                  <div className="text-sm py-1">{formatRelativeDate(item.updatedAt)}</div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {item?.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 p-1.5 rounded-md hover:bg-accent text-muted-foreground"
              title="Open in Notion"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {item && (
            <SessionActionMenu
              source={{
                type: "calendar",
                id: itemId,
                title: item.title,
                content: `Calendar item: ${item.title}\nDate: ${item.properties?.["Date"]?.date?.start || item.date || "unknown"}\nStatus: ${item.status || ""}`,
              }}
              linkedSessionId={linkedSession?.id}
              hidden={sessionOpen}
            />
          )}
        </>
      }
    />
  )

  if (loading || !item) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <PanelSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="p-6 text-destructive">Error loading calendar item: {error}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {header}
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="p-4">
          <NotionBlockRenderer blocks={item.children} />
        </div>
      </ScrollArea>
    </div>
  )
}
