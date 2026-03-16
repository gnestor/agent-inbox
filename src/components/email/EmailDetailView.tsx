import { useQuery } from "@tanstack/react-query"
import { useNavigation } from "@/hooks/use-navigation"
import { DetailView } from "@/components/shared/DetailView"
import { SessionActionMenu } from "@/components/session/AttachToSessionMenu"
import { getLinkedSession } from "@/api/client"
import { useEmailThread } from "@/hooks/use-email-thread"

interface EmailDetailViewProps {
  itemId: string
  title?: string
}

export function EmailDetailView({ itemId, title }: EmailDetailViewProps) {
  const { thread, loading, error } = useEmailThread(itemId)
  const { deselectItem } = useNavigation()

  const { data: linkedData } = useQuery({
    queryKey: ["linked-session", "thread", itemId],
    queryFn: () => getLinkedSession(itemId),
  })
  const linkedSession = linkedData?.session

  return (
    <DetailView
      title={title || thread?.subject || "Email"}
      loading={loading}
      error={error}
      onBack={deselectItem}
      headerRight={
        thread ? (
          <SessionActionMenu
            source={{
              type: "email",
              id: itemId,
              title: thread.subject,
              content: `Email thread: ${thread.subject}\n\nFrom: ${thread.messages[0]?.from}\n\n${thread.messages.map((m) => m.snippet).join("\n---\n")}`,
            }}
            newSessionPath={`/emails/${itemId}/session/new`}
            linkedSessionPath={
              linkedSession ? `/emails/${itemId}/session/${linkedSession.id}` : undefined
            }
            hasLinkedSession={!!linkedSession}
          />
        ) : undefined
      }
    >
      {/* Email content placeholder — will wire existing EmailThread content in a follow-up task */}
      {thread && (
        <div className="p-4 text-sm text-muted-foreground">
          Email thread content will be rendered here. Thread has {thread.messages.length} message
          {thread.messages.length !== 1 ? "s" : ""}.
        </div>
      )}
    </DetailView>
  )
}
