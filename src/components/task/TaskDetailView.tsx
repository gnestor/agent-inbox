import { TaskDetail } from "./TaskDetail"

export function TaskDetailView({ itemId }: { itemId: string }) {
  return <TaskDetail taskId={itemId} />
}
