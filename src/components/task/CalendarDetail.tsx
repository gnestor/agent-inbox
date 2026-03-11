import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  Button,
  ScrollArea,
  Badge,
  Table,
  TableBody,
  TableRow,
  TableCell,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@hammies/frontend/components/ui"
import { cn } from "@hammies/frontend/lib/utils"
import { Bot, ExternalLink, Ellipsis } from "lucide-react"
import { getCalendarItem, getLinkedSession } from "@/api/client"
import { formatRelativeDate, taskStatusBadgeClass } from "@/lib/formatters"
import { usePreference } from "@/hooks/use-preferences"
import { PanelHeader, BackButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { NotionBlockRenderer } from "./NotionBlockRenderer"

interface CalendarDetailProps {
  itemId: string
  title?: string
  sessionOpen?: boolean
}

export function CalendarDetail({ itemId, title, sessionOpen }: CalendarDetailProps) {
  const navigate = useNavigate()
  const { data: item, isLoading: loading, error: queryError } = useQuery({
    queryKey: ["calendar-item", itemId],
    queryFn: () => getCalendarItem(itemId),
  })
  const { data: linkedData } = useQuery({
    queryKey: ["linked-session", "calendar", itemId],
    queryFn: () => getLinkedSession(undefined, itemId),
  })
  const linkedSession = linkedData?.session
  const error = queryError?.message ?? null
  const [detailsExpanded, setDetailsExpanded] = usePreference("details.calendar.expanded", false)

  const header = (
    <PanelHeader
      left={
        <>
          <BackButton onClick={() => navigate("/calendar")} />
          <h2 className="font-semibold text-sm truncate">{title}</h2>
        </>
      }
      right={
        <>
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
            <DropdownMenuContent align="end" className="min-w-40">
              {item?.url && (
                <DropdownMenuItem
                  render={<a href={item.url} target="_blank" rel="noopener noreferrer" />}
                >
                  <ExternalLink className="h-4 w-4" />
                  Open in Notion
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {!sessionOpen && (
            <Button
              onClick={() =>
                navigate(
                  linkedSession
                    ? `/calendar/${itemId}/session/${linkedSession.id}`
                    : `/calendar/${itemId}/session/new`,
                )
              }
              size="sm"
            >
              <Bot className="h-4 w-4 md:mr-1" />
              <span className="hidden md:inline">
                {linkedSession ? "Open Session" : "Start Session"}
              </span>
            </Button>
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

  const date = item.properties?.["Date"]?.date?.start

  return (
    <div className="flex flex-col h-full">
      {header}
      <ScrollArea className="flex-1 overflow-hidden">
        <Accordion value={detailsExpanded ? ["details"] : []} onValueChange={(v) => setDetailsExpanded(v.includes("details"))}>
          <AccordionItem value="details" className="border-b">
            <AccordionTrigger className="px-4 py-2 text-sm font-medium hover:no-underline">
              Details
            </AccordionTrigger>
            <AccordionContent className="pb-0">
              <Table>
                <TableBody>
                  {date && (
                    <TableRow>
                      <TableCell className="text-muted-foreground font-medium px-4 py-2">Date</TableCell>
                      <TableCell className="px-4 py-2">{new Date(date).toLocaleDateString()}</TableCell>
                    </TableRow>
                  )}
                  <TableRow>
                    <TableCell className="text-muted-foreground font-medium px-4 py-2">Status</TableCell>
                    <TableCell className="px-4 py-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          taskStatusBadgeClass(item.status) ||
                            "bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30",
                        )}
                      >
                        {item.status || "—"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {item.tags.length > 0 && (
                    <TableRow>
                      <TableCell className="text-muted-foreground font-medium px-4 py-2">Tags</TableCell>
                      <TableCell className="px-4 py-2">
                        <div className="flex items-center gap-1 flex-wrap">
                          {item.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {item.assignee && (
                    <TableRow>
                      <TableCell className="text-muted-foreground font-medium px-4 py-2">Assignee</TableCell>
                      <TableCell className="px-4 py-2">{item.assignee}</TableCell>
                    </TableRow>
                  )}
                  <TableRow>
                    <TableCell className="text-muted-foreground font-medium px-4 py-2">Updated</TableCell>
                    <TableCell className="px-4 py-2">{formatRelativeDate(item.updatedAt)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="p-4">
          <NotionBlockRenderer blocks={item.children} />
        </div>
      </ScrollArea>
    </div>
  )
}
