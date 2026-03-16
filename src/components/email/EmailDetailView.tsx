import { EmailThread } from "./EmailThread"

export function EmailDetailView({ itemId }: { itemId: string }) {
  return <EmailThread threadId={itemId} />
}
