import { useQuery } from "@tanstack/react-query"
import { getTask, getLinkedSession, getNotionOptions } from "@/api/client"
import { useTaskMutation } from "./use-task-mutation"

export function useTaskDetail(taskId: string) {
  const { data: task, isLoading: loading, error: queryError } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => getTask(taskId),
  })
  const { data: linkedData } = useQuery({
    queryKey: ["linked-session", "task", taskId],
    queryFn: () => getLinkedSession(undefined, taskId),
  })
  const { data: statusOpts } = useQuery({
    queryKey: ["notion-options", "Status"],
    queryFn: () => getNotionOptions("Status"),
  })
  const { data: priorityOpts } = useQuery({
    queryKey: ["notion-options", "Priority"],
    queryFn: () => getNotionOptions("Priority"),
  })
  const { data: tagOpts } = useQuery({
    queryKey: ["notion-options", "Tags"],
    queryFn: () => getNotionOptions("Tags"),
  })

  const linkedSession = linkedData?.session
  const error = queryError?.message ?? null
  const mutation = useTaskMutation(taskId)

  const dueDate = task?.properties?.["Due Date"]?.date?.start
  const createdBy = task?.properties?.["Created By"]?.created_by?.name

  return {
    task,
    loading,
    error,
    linkedSession,
    mutation,
    statusOpts: statusOpts?.options ?? [],
    priorityOpts: priorityOpts?.options ?? [],
    tagOpts: tagOpts?.options ?? [],
    dueDate,
    createdBy,
  }
}
