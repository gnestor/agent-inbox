import { useMutation, useQueryClient } from "@tanstack/react-query"
import { updateTask } from "@/api/client"
import { toast } from "sonner"

export function useTaskMutation(taskId: string) {
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["task", taskId] })
    queryClient.invalidateQueries({ queryKey: ["tasks"] })
  }

  const mutation = useMutation({
    mutationFn: (properties: import("@/types/notion-mutations").TaskPropertyUpdate) => updateTask(taskId, properties),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(`Update failed: ${err.message}`),
  })

  return {
    updateStatus: (status: string) =>
      mutation.mutate({ Status: { status: { name: status } } }),
    updatePriority: (priority: string) =>
      mutation.mutate({ Priority: { select: { name: priority } } }),
    updateTags: (tags: string[]) =>
      mutation.mutate({ Tags: { multi_select: tags.map((name) => ({ name })) } }),
    updateAssignee: (assigneeId: string) =>
      mutation.mutate({ Assignee: { people: [{ id: assigneeId }] } }),
    isPending: mutation.isPending,
  }
}
