import { useQuery } from "@tanstack/react-query"
import { useNavigation } from "@/hooks/use-navigation"
import { DetailView } from "@/components/shared/DetailView"
import { getTask } from "@/api/client"

interface TaskDetailViewProps {
  itemId: string
  title?: string
}

export function TaskDetailView({ itemId, title }: TaskDetailViewProps) {
  const { data: task, isLoading, error } = useQuery({
    queryKey: ["task", itemId],
    queryFn: () => getTask(itemId),
  })
  const { deselectItem } = useNavigation()

  return (
    <DetailView
      title={title || task?.title || "Task"}
      loading={isLoading}
      error={error?.message}
      onBack={deselectItem}
    >
      {task && <div className="p-4 text-sm text-muted-foreground">Task detail content — wire existing TaskDetail content during switchover</div>}
    </DetailView>
  )
}
