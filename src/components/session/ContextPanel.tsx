import { useNavigation } from "@/hooks/use-navigation"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Badge,
} from "@hammies/frontend/components/ui"
import { User, Building2, Tag, ExternalLink } from "lucide-react"
import { cn } from "@hammies/frontend/lib/utils"
import { formatRelativeDate } from "@/lib/formatters"
import type { InboxContextData } from "@/types"

interface ContextPanelProps {
  data: InboxContextData
}

const ENTITY_ICONS = {
  person: User,
  company: Building2,
  topic: Tag,
}

export function ContextPanel({ data }: ContextPanelProps) {
  const { switchTab, selectItem } = useNavigation()
  const { entity, source, contextPages, relatedThreads, relatedTasks, summary } = data
  const EntityIcon = ENTITY_ICONS[entity.type] ?? User

  const subtitle = [entity.role, entity.company].filter(Boolean).join(" at ") || entity.email || entity.domain

  const defaultOpen = [
    contextPages.length > 0 ? "pages" : null,
    relatedThreads.length > 0 ? "threads" : null,
    relatedTasks.length > 0 ? "tasks" : null,
  ].filter(Boolean) as string[]

  return (
    <div className="border rounded-lg mx-3 my-2 text-sm overflow-hidden">
      {/* Entity header */}
      <div className="flex items-start gap-2.5 p-3 border-b bg-muted/30">
        <div className="shrink-0 mt-0.5 p-1.5 rounded-md bg-card border">
          <EntityIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold leading-tight">{entity.name}</div>
          {subtitle && <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>}
        </div>
        {source.type === "email" && source.threadId && (
          <button
            type="button"
            onClick={() => { switchTab("emails"); selectItem(source.threadId!) }}
            className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Open
          </button>
        )}
        {source.type === "task" && source.id && (
          <button
            type="button"
            onClick={() => { switchTab("tasks"); selectItem(source.id!) }}
            className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Open
          </button>
        )}
      </div>

      {/* Summary */}
      {summary && (
        <div className="px-3 py-2.5 text-xs text-muted-foreground bg-muted/20 border-b leading-relaxed">
          {summary}
        </div>
      )}

      {/* Accordion sections */}
      {(contextPages.length > 0 || relatedThreads.length > 0 || relatedTasks.length > 0) && (
        <Accordion defaultValue={defaultOpen}>
          {contextPages.length > 0 && (
            <AccordionItem value="pages" className="border-b last:border-b-0">
              <AccordionTrigger className="px-3 py-2 text-xs font-medium hover:no-underline">
                Context pages ({contextPages.length})
              </AccordionTrigger>
              <AccordionContent className="pb-0">
                <div className="divide-y">
                  {contextPages.map((page) => (
                    <div key={page.file} className="px-3 py-2">
                      <div className="text-[10px] text-muted-foreground font-mono mb-0.5">{page.file}</div>
                      <div className="font-medium text-xs leading-snug">{page.title}</div>
                      {page.summary && (
                        <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{page.summary}</div>
                      )}
                      {page.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {page.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {relatedThreads.length > 0 && (
            <AccordionItem value="threads" className="border-b last:border-b-0">
              <AccordionTrigger className="px-3 py-2 text-xs font-medium hover:no-underline">
                Related threads ({relatedThreads.length})
              </AccordionTrigger>
              <AccordionContent className="pb-0">
                <div className="divide-y">
                  {relatedThreads.map((thread) => (
                    <button
                      key={thread.threadId}
                      type="button"
                      onClick={() => { switchTab("emails"); selectItem(thread.threadId) }}
                      className={cn(
                        "w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors",
                      )}
                    >
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-medium text-xs truncate flex-1">{thread.subject}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatRelativeDate(thread.date)}
                        </span>
                      </div>
                      {thread.snippet && (
                        <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                          {thread.snippet}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {relatedTasks.length > 0 && (
            <AccordionItem value="tasks" className="last:border-b-0">
              <AccordionTrigger className="px-3 py-2 text-xs font-medium hover:no-underline">
                Related tasks ({relatedTasks.length})
              </AccordionTrigger>
              <AccordionContent className="pb-0">
                <div className="divide-y">
                  {relatedTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => { switchTab("tasks"); selectItem(task.id) }}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex items-center gap-2"
                    >
                      <span className="text-xs flex-1 truncate">{task.title}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                        {task.status}
                      </Badge>
                    </button>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      )}
    </div>
  )
}
