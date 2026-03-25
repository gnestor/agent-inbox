import { useMemo } from "react"
import { MessageSquare, ExternalLink } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { usePlugins, usePluginItems, usePluginSubItems } from "@/hooks/use-plugins"
import { PanelWidget } from "@/components/plugin/PanelWidget"
import { PanelHeader, SidebarButton } from "@/components/shared/PanelHeader"
import { ListSkeleton } from "@/components/shared/ListSkeleton"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { SessionActionMenu } from "@/components/session/AttachToSessionMenu"
import { mutatePluginItem, getLinkedSession } from "@/api/client"
import { getItemTitle } from "@/lib/plugin-utils"
import type { PluginManifest } from "@/api/client"
import type { PluginItem } from "@/types/plugin"
import type { WidgetDef } from "@/types/panels"

function autoDetailSchema(plugin: PluginManifest): WidgetDef[] {
  const kvFields: string[] = []
  const proseFields: string[] = []
  for (const f of plugin.fieldSchema) {
    if (f.type === "html" || f.type === "markdown") {
      proseFields.push(f.id)
    } else {
      kvFields.push(f.id)
    }
  }
  const widgets: WidgetDef[] = []
  if (kvFields.length > 0) widgets.push({ type: "kv-table", fields: kvFields })
  for (const f of proseFields) widgets.push({ type: "prose", field: f })
  return widgets
}

function formatSlackText(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+\|([^>]+)>/g, "@$1")   // <@UID|name> → @name
    .replace(/<@([A-Z0-9]+)>/g, "@$1")            // <@UID> → @UID
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")    // <#CID|name> → #name
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")        // <url|text> → text
    .replace(/<(https?:[^>]+)>/g, "$1")           // <url> → url
    .replace(/:([a-z0-9_+-]+):/g, (_, name) => EMOJI_MAP[name] ?? `:${name}:`)
}

const EMOJI_MAP: Record<string, string> = {
  slightly_smiling_face: "🙂", smile: "😊", grinning: "😀", joy: "😂",
  heart: "❤️", thumbsup: "+1", "+1": "👍", "-1": "👎", thumbsdown: "👎",
  fire: "🔥", eyes: "👀", wave: "👋", rocket: "🚀", check: "✅",
  white_check_mark: "✅", x: "❌", warning: "⚠️", tada: "🎉",
  pray: "🙏", clap: "👏", raised_hands: "🙌", thinking_face: "🤔",
  sweat_smile: "😅", sob: "😭", laughing: "😆", wink: "😉",
  sunglasses: "😎", star: "⭐", sparkles: "✨", disappointed: "😞",
}

function formatTs(ts: string): string {
  const n = parseFloat(ts)
  if (isNaN(n)) return ts
  return new Date(n * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function MessageRow({ item }: { item: PluginItem }) {
  const data = item as Record<string, unknown>
  const replyCount = Number(data.replyCount ?? 0)
  const avatar = data.userAvatar as string | undefined
  const name = String(data.userName ?? data.userId ?? "Unknown")
  const initials = name.slice(0, 2).toUpperCase()

  return (
    <div className="px-4 py-3 border-b last:border-0 hover:bg-secondary">
      <div className="flex gap-2.5">
        {avatar ? (
          <img src={avatar} alt={name} className="h-8 w-8 rounded-full shrink-0 mt-0.5" />
        ) : (
          <div className="h-8 w-8 rounded-full shrink-0 mt-0.5 bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="font-medium text-sm">{name}</span>
            <span className="text-xs text-muted-foreground">{formatTs(String(data.ts ?? ""))}</span>
            {replyCount > 0 && (
              <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {replyCount}
              </span>
            )}
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {formatSlackText(String(data.text ?? ""))}
          </p>
        </div>
      </div>
    </div>
  )
}

export function PluginDetail({
  pluginId,
  itemId,
}: {
  pluginId: string
  itemId: string
}) {
  const { data: plugins } = usePlugins()
  const plugin = plugins?.find((p) => p.id === pluginId)
  const hasSubItems = !!plugin?.hasSubItems

  // Always call both hooks — conditionally enable based on plugin type
  const { data: itemsData, isLoading: itemsLoading } = usePluginItems(pluginId, {}, undefined)
  const { data: subData, isLoading: subLoading } = usePluginSubItems(
    pluginId,
    itemId,
    {},
    undefined,
  )

  // Session linking
  const { data: linkedData } = useQuery({
    queryKey: ["linked-session", pluginId, itemId],
    queryFn: () => getLinkedSession(itemId, pluginId),
  })
  const linkedSession = linkedData?.session

  // Look up the parent item from the list query (for title, externalUrl, etc.)
  const parentItem = itemsData?.items.find((i) => i.id === itemId) as Record<string, unknown> | undefined
  const title = parentItem ? getItemTitle(parentItem) : itemId
  const externalUrl = parentItem?.externalUrl as string | undefined

  // Build session context from sub-items for session linking
  const sessionSource = useMemo(() => {
    if (!hasSubItems) return undefined
    const items = subData?.items ?? []
    const contextLines = items
      .slice(0, 20)
      .map((i) => {
        const d = i as Record<string, unknown>
        return `${d.userName ?? d.userId ?? "Unknown"}: ${d.text ?? ""}`
      })
      .join("\n")
    return {
      type: pluginId,
      id: itemId,
      title,
      content: `${pluginId} conversation: ${title}\n\n${contextLines}`,
    }
  }, [hasSubItems, subData?.items, pluginId, itemId, title])

  // Sub-items path (e.g. Slack: channel → messages)
  if (hasSubItems) {
    const items = subData?.items ?? []
    return (
      <div className="flex flex-1 flex-col min-h-0">
        <PanelHeader
          left={
            <div className="flex items-center gap-2">
              <SidebarButton />
              <span className="font-semibold text-sm">{title}</span>
            </div>
          }
          right={
            <>
              {externalUrl && (
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
                  title={`Open in ${plugin?.name ?? "app"}`}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
              {sessionSource && (
                <SessionActionMenu
                  source={sessionSource}
                  linkedSessionId={linkedSession?.id}
                />
              )}
            </>
          }
        />
        {subLoading && !items.length && <ListSkeleton itemHeight={72} />}
        {!subLoading && !items.length && (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No messages</div>
        )}
        {items.length > 0 && (
          <div className="flex-1 overflow-y-auto">
            {items.map((item) => (
              <MessageRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // Widget tree path
  const item = itemsData?.items.find((i) => i.id === itemId) as Record<string, unknown> | undefined

  if (!plugin || (!item && itemsLoading)) {
    return <PanelSkeleton />
  }
  if (!item) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Item not found</div>
    )
  }

  const widgets = plugin.detailSchema ?? autoDetailSchema(plugin)

  async function handleMutate(action: string, payload: unknown) {
    await mutatePluginItem(pluginId, itemId, action, payload)
  }

  const widgetSource = {
    type: pluginId,
    id: itemId,
    title: getItemTitle(item),
    content: JSON.stringify(item),
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <PanelHeader
        left={
          <div className="flex items-center gap-2">
            <SidebarButton />
            <span className="font-semibold text-sm">{getItemTitle(item)}</span>
          </div>
        }
        right={
          <SessionActionMenu
            source={widgetSource}
            linkedSessionId={linkedSession?.id}
          />
        }
      />
      <div className="flex-1 overflow-y-auto p-4">
        <PanelWidget widgets={widgets} data={item} onMutate={handleMutate} />
      </div>
    </div>
  )
}
