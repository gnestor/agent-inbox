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
import { getTask, getLinkedSession } from "@/api/client"
import { formatRelativeDate, taskStatusBadgeClass } from "@/lib/formatters"
import { usePreference } from "@/hooks/use-preferences"
import { PanelHeader, BackButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { NotionBlockRenderer } from "./NotionBlockRenderer"

interface TaskDetailProps {
  taskId: string
  title?: string
  sessionOpen?: boolean
}

export function TaskDetail({ taskId, title, sessionOpen }: TaskDetailProps) {
  const navigate = useNavigate()
  const { data: task, isLoading: loading, error: queryError } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => getTask(taskId),
  })
  const { data: linkedData } = useQuery({
    queryKey: ["linked-session", "task", taskId],
    queryFn: () => getLinkedSession(undefined, taskId),
  })
  const linkedSession = linkedData?.session
  const error = queryError?.message ?? null

  const header = (
    <PanelHeader
      left={
        <>
          <BackButton onClick={() => navigate("/tasks")} />
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
              {task?.url && (
                <DropdownMenuItem
                  render={<a href={task.url} target="_blank" rel="noopener noreferrer" />}
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
                    ? `/tasks/${taskId}/session/${linkedSession.id}`
                    : `/tasks/${taskId}/session/new`,
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

  if (loading || !task) {
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
        <div className="p-6 text-destructive">Error loading task: {error}</div>
      </div>
    )
  }

  const dueDate = task.properties?.["Due Date"]?.date?.start
  const createdBy = task.properties?.["Created By"]?.created_by?.name
  const [detailsExpanded, setDetailsExpanded] = usePreference("details.task.expanded", false)

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
                    <TableRow>
                      <TableCell className="text-muted-foreground font-medium px-4 py-2">Status</TableCell>
                      <TableCell className="px-4 py-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            taskStatusBadgeClass(task.status) ||
                              "bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30",
                          )}
                        >
                          {task.status || "—"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {task.priority && (
                      <TableRow>
                        <TableCell className="text-muted-foreground font-medium px-4 py-2">Priority</TableCell>
                        <TableCell className="px-4 py-2">{task.priority}</TableCell>
                      </TableRow>
                    )}
                    {task.tags.length > 0 && (
                      <TableRow>
                        <TableCell className="text-muted-foreground font-medium px-4 py-2">Tags</TableCell>
                        <TableCell className="px-4 py-2">
                          <div className="flex items-center gap-1 flex-wrap">
                            {task.tags.map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {(task.assignee || createdBy) && (
                      <TableRow>
                        <TableCell className="text-muted-foreground font-medium px-4 py-2">Assignee</TableCell>
                        <TableCell className="px-4 py-2">{task.assignee || createdBy}</TableCell>
                      </TableRow>
                    )}
                    {dueDate && (
                      <TableRow>
                        <TableCell className="text-muted-foreground font-medium px-4 py-2">Due Date</TableCell>
                        <TableCell className="px-4 py-2">{new Date(dueDate).toLocaleDateString()}</TableCell>
                      </TableRow>
                    )}
                    <TableRow>
                      <TableCell className="text-muted-foreground font-medium px-4 py-2">Updated</TableCell>
                      <TableCell className="px-4 py-2">{formatRelativeDate(task.updatedAt)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="p-4">
          <NotionBlockRenderer blocks={task.children} />
        </div>
      </ScrollArea>
    </div>
  )
}
