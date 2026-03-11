import { useMutation, useQueryClient } from "@tanstack/react-query"
import { updateCalendarItem } from "@/api/client"
import { toast } from "sonner"

export function useCalendarMutation(itemId: string) {
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["calendar-item", itemId] })
    queryClient.invalidateQueries({ queryKey: ["calendar"] })
  }

  const mutation = useMutation({
    mutationFn: (properties: Record<string, unknown>) => updateCalendarItem(itemId, properties),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(`Update failed: ${err.message}`),
  })

  return {
    updateStatus: (status: string) =>
      mutation.mutate({ Status: { status: { name: status } } }),
    updateTags: (tags: string[]) =>
      mutation.mutate({ Tags: { multi_select: tags.map((name) => ({ name })) } }),
    updateAssignee: (assigneeId: string) =>
      mutation.mutate({ Assignee: { people: [{ id: assigneeId }] } }),
    updateDate: (date: string) =>
      mutation.mutate({ Date: { date: { start: date } } }),
    isPending: mutation.isPending,
  }
}
