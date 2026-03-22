import {
  ScrollArea,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@hammies/frontend/components/ui"
import { ExternalLink, SlidersHorizontal } from "lucide-react"
import { formatRelativeDate } from "@/lib/formatters"
import { SessionActionMenu } from "@/components/session/AttachToSessionMenu"
import { PanelHeader, BackButton, SidebarButton } from "@/components/shared/PanelHeader"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { PropertySelect, PropertyMultiSelect } from "@/components/shared/PropertyEditor"
import { NotionBlockRenderer } from "./NotionBlockRenderer"
import { useTaskDetail } from "@/hooks/use-task-detail"
import { useNavigation } from "@/hooks/use-navigation"
import { useLocation } from "react-router-dom"

interface TaskDetailProps {
  taskId: string
  title?: string
  sessionOpen?: boolean
}

export function TaskDetail({ taskId, title, sessionOpen }: TaskDetailProps) {
  const { deselectItem } = useNavigation()
  const location = useLocation()
  const isFromSidebar = !!(location.state as { fromSidebar?: boolean } | null)?.fromSidebar
  const {
    task, loading, error, linkedSession, mutation,
    statusOpts, priorityOpts, tagOpts,
    dueDate, createdBy,
  } = useTaskDetail(taskId)

  const header = (
    <PanelHeader
      left={
        <>
          {isFromSidebar ? <SidebarButton /> : <BackButton onClick={() => deselectItem()} />}
          <h2 className="font-semibold text-sm truncate">{title ?? task?.title}</h2>
        </>
      }
      right={
        <>
          {task && (
            <Popover>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
                    title="Properties"
                  />
                }
              >
                <SlidersHorizontal className="h-4 w-4" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-4 gap-0">
                <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <PropertySelect
                    value={task.status}
                    options={statusOpts}
                    onChange={mutation.updateStatus}
                    loading={mutation.isPending}
                  />
                  <label className="text-sm font-medium">Priority</label>
                  <PropertySelect
                    value={task.priority || ""}
                    options={priorityOpts}
                    onChange={mutation.updatePriority}
                    loading={mutation.isPending}
                  />
                  <label className="text-sm font-medium self-start pt-1.5">Tags</label>
                  <PropertyMultiSelect
                    value={task.tags}
                    options={tagOpts}
                    onChange={mutation.updateTags}
                    loading={mutation.isPending}
                    placeholder="Add tag..."
                  />
                  {(task.assignee || createdBy) && (
                    <>
                      <label className="text-sm font-medium">Assignee</label>
                      <div className="text-sm py-1">{task.assignee || createdBy}</div>
                    </>
                  )}
                  {dueDate && (
                    <>
                      <label className="text-sm font-medium">Due Date</label>
                      <div className="text-sm py-1">{new Date(dueDate).toLocaleDateString()}</div>
                    </>
                  )}
                  <label className="text-sm font-medium">Updated</label>
                  <div className="text-sm py-1">{formatRelativeDate(task.updatedAt)}</div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {task?.url && (
            <a
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
              title="Open in Notion"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          {task && (
            <SessionActionMenu
              source={{
                type: "task",
                id: taskId,
                title: task.title,
                content: `Notion task: ${task.title}\nStatus: ${task.status}\n\n${task.body || ""}`,
              }}
              linkedSessionId={linkedSession?.id}
              hidden={sessionOpen}
            />
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

  return (
    <div className="flex flex-col h-full">
      {header}
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="p-4">
          <NotionBlockRenderer blocks={task.children} />
        </div>
      </ScrollArea>
    </div>
  )
}
