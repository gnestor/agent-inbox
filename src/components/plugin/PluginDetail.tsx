import { Plug } from "lucide-react"
import { usePlugins, usePluginItems, usePluginSubItems } from "@/hooks/use-plugins"
import { PanelWidget } from "@/components/plugin/PanelWidget"
import { PanelHeader, SidebarButton } from "@/components/shared/PanelHeader"
import { EmptyState } from "@/components/shared/EmptyState"
import { ListSkeleton } from "@/components/shared/ListSkeleton"
import { mutatePluginItem } from "@/api/client"
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

function getItemTitle(item: Record<string, unknown>): string {
  for (const key of ["title", "name", "channelName", "subject", "text", "summary"]) {
    if (typeof item[key] === "string" && item[key]) return item[key] as string
  }
  return String(item.id ?? "")
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
  return (
    <div className="px-4 py-3 border-b last:border-0 hover:bg-secondary">
      <div className="flex items-baseline gap-2 mb-0.5">
        <span className="font-medium text-sm">
          {String(data.userName ?? data.userId ?? "Unknown")}
        </span>
        <span className="text-xs text-muted-foreground">{formatTs(String(data.ts ?? ""))}</span>
        {replyCount > 0 && (
          <span className="text-xs text-muted-foreground ml-auto">
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </span>
        )}
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
        {formatSlackText(String(data.text ?? ""))}
      </p>
    </div>
  )
}

export function PluginDetail({
  pluginId,
  itemId,
  parentTitle,
}: {
  pluginId: string
  itemId: string
  parentTitle?: string
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

  const title = parentTitle || itemId

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
        />
        {subLoading && !items.length && <ListSkeleton itemHeight={72} />}
        {!subLoading && !items.length && <EmptyState icon={Plug} message="No messages" />}
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
    return <EmptyState icon={Plug} message="Loading..." />
  }
  if (!item) {
    return <EmptyState icon={Plug} message="Item not found" />
  }

  const widgets = plugin.detailSchema ?? autoDetailSchema(plugin)

  async function handleMutate(action: string, payload: unknown) {
    await mutatePluginItem(pluginId, itemId, action, payload)
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <PanelHeader
        left={
          <div className="flex items-center gap-2">
            <SidebarButton />
            <span className="font-semibold text-sm">{parentTitle || getItemTitle(item)}</span>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-4">
        <PanelWidget widgets={widgets} data={item} onMutate={handleMutate} />
      </div>
    </div>
  )
}
