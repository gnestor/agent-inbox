import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import {
  Button,
  ScrollArea,
  Badge,
  Table,
  TableBody,
  TableRow,
  TableCell,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@hammies/frontend/components/ui"
import { cn } from "@hammies/frontend/lib/utils"
import { Bot, ExternalLink, Ellipsis } from "lucide-react"
import { getTask } from "@/api/client"
import { getListCache, setListCache } from "@/lib/list-cache"
import { formatRelativeDate, taskStatusBadgeClass } from "@/lib/formatters"
import { PanelHeader, BackButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { NotionBlockRenderer } from "./NotionBlockRenderer"
import type { NotionTaskDetail } from "@/types"

interface TaskDetailProps {
  taskId: string
  title?: string
}

export function TaskDetail({ taskId, title }: TaskDetailProps) {
  const cached = getListCache<NotionTaskDetail>(`task:${taskId}`)
  const [task, setTask] = useState<NotionTaskDetail | null>(cached ?? null)
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!getListCache(`task:${taskId}`)) setLoading(true)
    setError(null)
    getTask(taskId)
      .then((data) => {
        setTask(data)
        setListCache(`task:${taskId}`, data)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [taskId])

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
          <Button onClick={() => navigate(`/tasks/${taskId}/session/new`)} size="sm">
            <Bot className="h-4 w-4 md:mr-1" />
            <span className="hidden md:inline">Start Session</span>
          </Button>
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

  return (
    <div className="flex flex-col h-full">
      {header}
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="p-4 space-y-4">
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="text-muted-foreground font-medium">Status</TableCell>
                <TableCell>
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
                  <TableCell className="text-muted-foreground font-medium">Priority</TableCell>
                  <TableCell>{task.priority}</TableCell>
                </TableRow>
              )}
              {task.tags.length > 0 && (
                <TableRow>
                  <TableCell className="text-muted-foreground font-medium">Tags</TableCell>
                  <TableCell>
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
                  <TableCell className="text-muted-foreground font-medium">Assignee</TableCell>
                  <TableCell>{task.assignee || createdBy}</TableCell>
                </TableRow>
              )}
              {dueDate && (
                <TableRow>
                  <TableCell className="text-muted-foreground font-medium">Due Date</TableCell>
                  <TableCell>{new Date(dueDate).toLocaleDateString()}</TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell className="text-muted-foreground font-medium">Updated</TableCell>
                <TableCell>{formatRelativeDate(task.updatedAt)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <NotionBlockRenderer blocks={task.children} />
        </div>
      </ScrollArea>
    </div>
  )
}
