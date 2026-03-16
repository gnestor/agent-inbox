import { useQuery } from "@tanstack/react-query"
import { useNavigation } from "@/hooks/use-navigation"
import { DetailView } from "@/components/shared/DetailView"
import { getCalendarItem } from "@/api/client"

interface CalendarDetailViewProps {
  itemId: string
  title?: string
}

export function CalendarDetailView({ itemId, title }: CalendarDetailViewProps) {
  const { data: item, isLoading, error } = useQuery({
    queryKey: ["calendar-item", itemId],
    queryFn: () => getCalendarItem(itemId),
  })
  const { deselectItem } = useNavigation()

  return (
    <DetailView
      title={title || item?.title || "Calendar"}
      loading={isLoading}
      error={error?.message}
      onBack={deselectItem}
    >
      {item && <div className="p-4 text-sm text-muted-foreground">Calendar detail content — wire existing CalendarDetail content during switchover</div>}
    </DetailView>
  )
}
