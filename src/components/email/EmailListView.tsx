import { useMemo } from "react"
import { useNavigation } from "@/hooks/use-navigation"
import { ListView } from "@/components/shared/ListView"
import { useEmails } from "@/hooks/use-emails"
import { getEmailLabels } from "@/api/client"
import { formatEmailAddress } from "@/lib/formatters"
import { BadgeToggleMenu } from "@/components/shared/BadgeToggleMenu"
import { usePreference } from "@/hooks/use-preferences"
import { Mail } from "lucide-react"
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
  {
    id: "flags",
    label: "Flags",
    type: "text",
    listRole: "hidden",
    filter: {
      filterable: true,
      filterOptions: ["important", "starred", "unread", "snoozed"],
    },
  },
  {
    id: "labels",
    label: "Labels",
    type: "text",
    listRole: "hidden",
    filter: { filterable: true },
  },
]

const emailOptionsFetcher: Record<string, () => Promise<string[]>> = {
  labels: () =>
    getEmailLabels().then((r) =>
      r.labels
        .filter((l) => l.type === "user")
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((l) => l.name),
    ),
}

const getThreadId = (t: Record<string, unknown>) => t.threadId as string

export function EmailListView() {
  const { selectItem, getSelectedItemId, getFilters, setFilter, switchTab } = useNavigation()
  const filters = getFilters("emails")

  const query = useMemo(() => {
    const flags = (filters.flags || "").split(",").filter(Boolean)
    const parts: string[] = ["in:inbox"]
    if (flags.length === 0) {
      parts.push("is:important OR is:starred")
    } else if (flags.length === 1) {
      parts.push(`is:${flags[0]}`)
    } else {
      parts.push(`(${flags.map((f) => `is:${f}`).join(" OR ")})`)
    }
    // Gmail label filters
    const labelValues = (filters.labels || "").split(",").filter(Boolean)
    for (const l of labelValues) {
      parts.push(`label:${l.replace(/\s+/g, "-")}`)
    }
    const q = filters.q
    if (q) parts.push(q)
    return parts.join(" ")
  }, [filters.flags, filters.labels, filters.q])

  const { messages, loading, error, hasMore, loadMore } = useEmails(query)

  const isConnectionError = error?.includes("Google account not connected")

  const connectionErrorContent = isConnectionError ? (
    <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
      <Mail className="h-8 w-8 mb-2" />
      <p className="text-sm font-medium mb-1">Google account not connected</p>
      <p className="text-xs text-center mb-3">Connect your Google account to see your emails.</p>
      <button
        onClick={() => switchTab("settings")}
        className="text-xs text-primary hover:underline cursor-pointer"
      >
        Go to Integrations
      </button>
    </div>
  ) : undefined

  const [showReadStatus, setShowReadStatus] = usePreference("emails.showReadStatus", true)
  const [showImportant, setShowImportant] = usePreference("emails.showImportant", true)
  const [showStarred, setShowStarred] = usePreference("emails.showStarred", true)

  const hiddenBadgeFields = useMemo(() => {
    const hidden = new Set<string>()
    if (!showReadStatus) hidden.add("isUnread")
    if (!showImportant) hidden.add("isImportant")
    if (!showStarred) hidden.add("isStarred")
    return hidden
  }, [showReadStatus, showImportant, showStarred])

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
      items={threads}
      fieldSchema={emailFieldSchema}
      getItemId={getThreadId}
      selectedId={getSelectedItemId("emails")}
      onSelect={selectItem}
    >
      <ListView.Header title="Emails">
        <ListView.Filters
          activeFilters={filters}
          onFilterChange={setFilter}
          optionsFetcher={emailOptionsFetcher}
        />
        <BadgeToggleMenu
          items={[
            { label: "Read status", checked: showReadStatus, onChange: setShowReadStatus },
            { label: "Important", checked: showImportant, onChange: setShowImportant },
            { label: "Starred", checked: showStarred, onChange: setShowStarred },
          ]}
        />
      </ListView.Header>
      <ListView.Search
        placeholder="Search emails..."
        onSearch={(q) => setFilter("q", q)}
      />
      <ListView.Body
        itemHeight={100}
        loading={loading}
        error={error}
        errorContent={connectionErrorContent}
        hasMore={hasMore}
        loadMore={loadMore}
        hiddenBadgeFields={hiddenBadgeFields}
        emptyMessage="No emails found"
      />
    </ListView>
  )
}
