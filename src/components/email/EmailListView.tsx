import { useMemo } from "react"
import { useNavigation } from "@/hooks/use-navigation"
import { ListView } from "@/components/shared/ListView"
import { useEmails } from "@/hooks/use-emails"
import { formatEmailAddress } from "@/lib/formatters"
import type { FieldDef } from "@/types/plugin"

export const emailFieldSchema: FieldDef[] = [
  { id: "fromDisplay", label: "From", type: "text", listRole: "title" },
  { id: "subject", label: "Subject", type: "text", listRole: "subtitle" },
  { id: "date", label: "Date", type: "date", listRole: "timestamp" },
  {
    id: "isUnread",
    label: "Unread",
    type: "boolean",
    badge: {
      show: "if-set",
      variant: "default",
      colorFn: () => "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    },
  },
  {
    id: "isImportant",
    label: "Important",
    type: "boolean",
    badge: {
      show: "if-set",
      colorFn: () => "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
    },
  },
  {
    id: "isStarred",
    label: "Starred",
    type: "boolean",
    badge: {
      show: "if-set",
      colorFn: () => "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
    },
  },
  { id: "body", label: "Body", type: "html", listRole: "hidden" },
]

export function EmailListView() {
  const { selectItem, getSelectedItemId, activeFilters, setFilter } = useNavigation()
  const { messages, loading, error, hasMore, loadMore } = useEmails()

  // Deduplicate messages by threadId (keep first occurrence per thread)
  // and add derived fields for the schema
  const threads = useMemo(() => {
    const seen = new Set<string>()
    return messages
      .filter((msg) => {
        if (seen.has(msg.threadId)) return false
        seen.add(msg.threadId)
        return true
      })
      .map((msg) => ({
        ...msg,
        fromDisplay: formatEmailAddress(msg.from),
        isImportant: msg.labelIds.includes("IMPORTANT"),
        isStarred: msg.labelIds.includes("STARRED"),
      }))
  }, [messages])

  return (
    <ListView
      title="Emails"
      items={threads}
      loading={loading}
      error={error}
      fieldSchema={emailFieldSchema}
      getItemId={(t) => t.threadId}
      selectedId={getSelectedItemId()}
      onSelect={selectItem}
      itemHeight={100}
      activeFilters={activeFilters}
      onFilterChange={setFilter}
      hasMore={hasMore}
      loadMore={loadMore}
      searchPlaceholder="Search emails..."
      onSearch={(q) => setFilter("q", q)}
    />
  )
}
