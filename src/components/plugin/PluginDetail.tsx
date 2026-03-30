import { useMemo } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import TurndownService from "turndown"
import { MessageSquare, ExternalLink, CheckCircle, RotateCcw, Archive, Trash2, type LucideIcon } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useIframeAutoHeight } from "@/hooks/use-iframe-auto-height"
import { usePlugins, usePluginItems, usePluginSubItems, usePluginItem } from "@/hooks/use-plugins"
import { PanelWidget } from "@/components/plugin/PanelWidget"
import { PanelHeader, SidebarButton } from "@/components/shared/PanelHeader"
import { ListSkeleton } from "@/components/shared/ListSkeleton"
import { PanelSkeleton } from "@/components/shared/PanelSkeleton"
import { SessionActionMenu } from "@/components/session/AttachToSessionMenu"
import { mutatePluginItem, getLinkedSession } from "@/api/client"
import { getItemTitle } from "@/lib/plugin-utils"
import { formatEmailAddress, formatRelativeDate } from "@/lib/formatters"
import { EmailThread } from "@plugins/gmail/app/components/EmailThread"
import { PluginFrame } from "@/components/plugin/PluginFrame"
import { PropertiesPopover } from "@/components/plugin/PropertiesPopover"
import type { PluginManifest } from "@/api/client"
import type { PluginItem } from "@/types/plugin"
import type { WidgetDef } from "@/types/panels"

const ACTION_ICONS: Record<string, LucideIcon> = {
  close: CheckCircle,
  reopen: RotateCcw,
  archive: Archive,
  delete: Trash2,
}

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

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })
const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeHighlight]

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

function HtmlMessageBody({ html }: { html: string }) {
  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    *, *::before, *::after { box-sizing: border-box; background: none !important; }
    html, body { margin: 0; padding: 0; overflow: hidden; background: transparent !important;
      color: var(--foreground, inherit); font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: 14px; line-height: 1.5; }
    img { max-width: 100%; height: auto; }
    a { color: var(--foreground, inherit) !important; opacity: 0.7; word-break: break-all; }
    blockquote { margin: 0.5em 0; padding-left: 0.75em; border-left: 2px solid color-mix(in srgb, var(--foreground) 20%, transparent); }
    p { margin: 0.25em 0; }
    table { border-collapse: collapse; max-width: 100%; }
    td, th { padding: 2px 6px; }
  </style></head><body>${html}</body></html>`

  const { iframeRef } = useIframeAutoHeight(srcDoc)

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      className="w-full border-0 overflow-hidden h-0"
    />
  )
}

function MessageRow({ item }: { item: PluginItem }) {
  const data = item as Record<string, unknown>
  const replyCount = Number(data.replyCount ?? 0)
  const avatar = data.userAvatar as string | undefined
  const name = String(data.userName ?? data.userId ?? "Unknown")
  const initials = name.slice(0, 2).toUpperCase()
  const isHtml = data.bodyType === "html"
  const text = String(data.text ?? "")
  const markdown = useMemo(() => (isHtml && text ? turndown.turndown(text) : null), [isHtml, text])
  const attachments = (data.attachments ?? []) as Array<{ url: string; contentType: string; name: string; size?: number }>
  const imageAttachments = attachments.filter((a) => a.contentType?.startsWith("image/"))
  const otherAttachments = attachments.filter((a) => !a.contentType?.startsWith("image/"))

  return (
    <div className="px-4 py-3 border-b last:border-0 hover:bg-secondary overflow-hidden">
      <div className="flex gap-2.5 min-w-0">
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
          {imageAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {imageAttachments.map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={a.url}
                    alt={a.name}
                    className="max-w-[240px] max-h-[240px] rounded-md object-cover"
                  />
                </a>
              ))}
            </div>
          )}
          {markdown ? (
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
              <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
                {markdown}
              </Markdown>
            </div>
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
              {formatSlackText(text)}
            </p>
          )}
          {otherAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1.5">
              {otherAttachments.map((a, i) => (
                <a
                  key={i}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground underline hover:text-foreground truncate inline-block"
                >
                  {a.name}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Renders a single embedded message (e.g. Gmail thread message, Notion child block). */
function EmbeddedMessage({ msg }: { msg: Record<string, unknown> }) {
  const from = String(msg.from ?? msg.userName ?? msg.userId ?? "Unknown")
  const date = String(msg.date ?? "")
  const body = String(msg.body ?? msg.text ?? "")
  const bodyFormat = String(msg.bodyFormat ?? msg.bodyType ?? "plain")
  const formattedDate = date ? formatRelativeDate(date) : ""
  const displayName = formatEmailAddress(from)

  return (
    <div className="px-4 py-3 border-b last:border-0">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="font-medium text-sm">{displayName}</span>
        <span className="text-xs text-muted-foreground">{formattedDate}</span>
      </div>
      {bodyFormat === "html" || body.startsWith("<") ? (
        <HtmlMessageBody html={body} />
      ) : bodyFormat === "markdown" ? (
        <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
          <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>{body}</Markdown>
        </div>
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{body}</p>
      )}
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
  const queryClient = useQueryClient()
  const { data: plugins } = usePlugins()
  const plugin = plugins?.find((p) => p.id === pluginId)
  const hasSubItems = !!plugin?.hasSubItems
  const hasGetItem = !!plugin?.hasGetItem

  // Fetch list items only as fallback when getItem isn't available
  const { data: itemsData, isPending: itemsPending } = usePluginItems(pluginId, {}, undefined, !hasGetItem)
  const { data: fullItem, isPending: fullItemPending } = usePluginItem(pluginId, itemId, hasGetItem)
  const { data: subData, isPending: subPending } = usePluginSubItems(
    pluginId,
    itemId,
    {},
    undefined,
    hasSubItems,
  )

  // Session linking
  const { data: linkedData } = useQuery({
    queryKey: ["linked-session", pluginId, itemId],
    queryFn: () => getLinkedSession(itemId, pluginId),
  })
  const linkedSession = linkedData?.session

  // Use full item from getItem() if available, otherwise look up from list
  const listItem = itemsData?.items.find((i) => i.id === itemId) as Record<string, unknown> | undefined
  const parentItem = (fullItem as Record<string, unknown> | undefined) ?? listItem
  const title = parentItem ? getItemTitle(parentItem) : itemId
  const externalUrl = (parentItem?.externalUrl ?? parentItem?.url) as string | undefined

  // Shared mutation handler for both sub-items and widget-tree paths
  async function handleMutate(action: string, payload: unknown) {
    try {
      await mutatePluginItem(pluginId, itemId, action, payload)
      queryClient.invalidateQueries({ queryKey: ["plugin-items", pluginId] })
    } catch (err) {
      console.error(`[${pluginId}] ${action} failed:`, (err as Error).message)
    }
  }

  // Action buttons from detailSchema (shared across render paths)
  const actionButtons = plugin?.detailSchema
    ?.filter((w): w is import("@/types/panels").ActionButtonsWidget => w.type === "action-buttons")
    .flatMap((w) => w.actions) ?? []

  // Properties popover for items with editable fields (e.g. Notion tasks/calendar)
  const hasEditableFields = plugin?.fieldSchema?.some((f) =>
    (f.type === "select" || f.type === "multiselect") && f.filter?.filterable
  )

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

  // Sub-items path (e.g. Slack: channel → messages, Gorgias: ticket → messages)
  if (hasSubItems) {
    const items = subData?.items ?? []

    // Resolve dynamic actions: archive ↔ reopen based on item status
    const itemStatus = parentItem?.status as string | undefined
    const resolvedActions = actionButtons.map((action) => {
      if (action.mutation === "archive" && itemStatus === "closed") {
        return { ...action, label: "Reopen", mutation: "reopen" }
      }
      return action
    })

    return (
      <div className="flex flex-1 flex-col min-h-0">
        <PanelHeader
          left={
            <div className="flex items-center gap-2 min-w-0">
              <SidebarButton />
              <span className="font-semibold text-sm truncate">{title}</span>
            </div>
          }
          right={
            <>
              {resolvedActions.map((action) => {
                const Icon = ACTION_ICONS[action.mutation]
                return (
                  <button
                    key={action.mutation}
                    type="button"
                    title={action.label}
                    className={`shrink-0 p-1.5 rounded-md ${
                      action.variant === "destructive"
                        ? "text-destructive hover:bg-destructive/10"
                        : "text-muted-foreground hover:bg-secondary"
                    }`}
                    onClick={() => handleMutate(action.mutation, undefined)}
                  >
                    {Icon ? <Icon className="h-4 w-4" /> : <span className="text-xs">{action.label}</span>}
                  </button>
                )
              })}
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
        {subPending && !items.length && <ListSkeleton itemHeight={72} />}
        {!subPending && !items.length && (
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

  // Plugins with a dedicated detail component
  if (plugin?.components?.detail) {
    // Gmail: direct import (will move to iframe when EmailThread is self-contained)
    if (pluginId === "gmail") {
      return <EmailThread threadId={itemId} />
    }
    // Workspace plugins: render via PluginFrame iframe
    return (
      <div className="flex flex-1 flex-col min-h-0">
        <PanelHeader
          left={
            <div className="flex items-center gap-2 min-w-0">
              <SidebarButton />
              <span className="font-semibold text-sm truncate">{title}</span>
            </div>
          }
          right={
            <>
              {hasEditableFields && (
                <PropertiesPopover pluginId={pluginId} itemId={itemId} item={parentItem!} />
              )}
              {externalUrl && (
                <a href={externalUrl} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 p-1.5 rounded-md hover:bg-secondary text-muted-foreground"
                  title={`Open in ${plugin?.name ?? "app"}`}>
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
              {actionButtons.map((action) => {
                const Icon = ACTION_ICONS[action.mutation]
                return (
                  <button key={action.mutation} type="button" title={action.label}
                    className={`shrink-0 p-1.5 rounded-md ${
                      action.variant === "destructive"
                        ? "text-destructive hover:bg-destructive/10"
                        : "text-muted-foreground hover:bg-secondary"
                    }`}
                    onClick={() => handleMutate(action.mutation, undefined)}>
                    {Icon ? <Icon className="h-4 w-4" /> : <span className="text-xs">{action.label}</span>}
                  </button>
                )
              })}
              <SessionActionMenu
                source={{ type: pluginId, id: itemId, title, content: JSON.stringify(parentItem) }}
                linkedSessionId={linkedSession?.id}
              />
            </>
          }
        />
        <PluginFrame
          pluginId={pluginId}
          componentName={plugin.components.detail}
          componentProps={{ itemId, pluginId }}
          className="w-full flex-1 border-0"
        />
      </div>
    )
  }

  // Widget tree path — use full item from getItem() if available
  const item = parentItem
  const isLoading = hasGetItem ? fullItemPending : itemsPending

  if (!plugin || (!item && isLoading)) {
    return <PanelSkeleton />
  }
  if (!item) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Item not found</div>
    )
  }

  // Other plugins with embedded messages: generic rendering
  const embeddedMessages = item.messages as Record<string, unknown>[] | undefined
  if (embeddedMessages && embeddedMessages.length > 0) {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        <PanelHeader
          left={
            <div className="flex items-center gap-2 min-w-0">
              <SidebarButton />
              <span className="font-semibold text-sm truncate">{getItemTitle(item)}</span>
            </div>
          }
          right={
            <SessionActionMenu
              source={{ type: pluginId, id: itemId, title: getItemTitle(item), content: JSON.stringify(item) }}
              linkedSessionId={linkedSession?.id}
            />
          }
        />
        <div className="flex-1 overflow-y-auto">
          {embeddedMessages.map((msg) => (
            <EmbeddedMessage key={String(msg.id)} msg={msg} />
          ))}
        </div>
      </div>
    )
  }

  const widgets = plugin.detailSchema ?? autoDetailSchema(plugin)

  const widgetSource = {
    type: pluginId,
    id: itemId,
    title: getItemTitle(item),
    content: JSON.stringify(item),
  }

  const bodyContent = item.body as string | undefined
  const bodyFormat = item.bodyFormat as string | undefined

  const toolbarRight = (
    <>
      {hasEditableFields && (
        <PropertiesPopover pluginId={pluginId} itemId={itemId} item={item} />
      )}
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
      {actionButtons.map((action) => {
        const Icon = ACTION_ICONS[action.mutation]
        return (
          <button
            key={action.mutation}
            type="button"
            title={action.label}
            className={`shrink-0 p-1.5 rounded-md ${
              action.variant === "destructive"
                ? "text-destructive hover:bg-destructive/10"
                : "text-muted-foreground hover:bg-secondary"
            }`}
            onClick={() => handleMutate(action.mutation, undefined)}
          >
            {Icon ? <Icon className="h-4 w-4" /> : <span className="text-xs">{action.label}</span>}
          </button>
        )
      })}
      <SessionActionMenu
        source={widgetSource}
        linkedSessionId={linkedSession?.id}
      />
    </>
  )

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <PanelHeader
        left={
          <div className="flex items-center gap-2 min-w-0">
            <SidebarButton />
            <span className="font-semibold text-sm truncate">{getItemTitle(item)}</span>
          </div>
        }
        right={toolbarRight}
      />
      <div className="flex-1 overflow-y-auto p-4">
        {bodyContent && bodyFormat === "markdown" ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>{bodyContent}</Markdown>
          </div>
        ) : bodyContent && (bodyFormat === "html" || bodyContent.startsWith("<")) ? (
          <HtmlMessageBody html={bodyContent} />
        ) : (
          <PanelWidget widgets={widgets} data={item} onMutate={handleMutate} />
        )}
      </div>
    </div>
  )
}
