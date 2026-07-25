import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import type { TranscriptHost } from "@hammies/frontend/components/session"
import { extractXmlTag } from "@hammies/session-core"
import { getPanelSchemas, getSessionFileUrl } from "@/api/client"
import { PanelWidget } from "@/components/plugin/PanelWidget"
import { ContextPanel } from "./ContextPanel"
import { InboxResultPanel } from "./InboxResultPanel"
import { OutputRenderer } from "./OutputRenderer"
import { MarkdownEntry } from "@hammies/frontend/components/session"
import type { InboxContextData, InboxResultData } from "@/types"

/**
 * Inbox's implementation of the shared transcript's host capabilities.
 *
 * Built through a hook because one of the seams needs data: the panel-schema
 * registry is fetched once here (a day-long staleTime) rather than per text
 * block, which is what the old in-component `useQuery` did.
 *
 * The result is memoized on that data, so the host identity only changes when
 * the schemas actually load. The transcript reads it through context on every
 * row, so an unstable value would re-render the whole document-flow transcript.
 */
export function useInboxTranscriptHost(): TranscriptHost {
  const { data: panelSchemas } = useQuery({
    queryKey: ["panel-schemas"],
    queryFn: getPanelSchemas,
    staleTime: 86_400_000,
  })

  return useMemo<TranscriptHost>(
    () => ({
      renderOutput: ({ spec, sessionId, sequence, onAction, onLoaded }) => (
        <OutputRenderer
          spec={spec}
          sessionId={sessionId ?? ""}
          sequence={sequence}
          onAction={onAction}
          onArtifactLoaded={onLoaded}
        />
      ),
      fileUrl: getSessionFileUrl,
      // Assistant text may embed a structured payload: the two builtin inbox
      // tags, or any tag a plugin declares via its panel schema. Anything else
      // returns null and renders as ordinary markdown.
      renderTextBlock: ({ text, agentLabel, sessionId }) => {
        const withRest = (node: React.ReactNode, tag: string) => {
          const rest = text.replace(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`), "").trim()
          return (
            <>
              {node}
              {rest && <MarkdownEntry text={rest} label={agentLabel} />}
            </>
          )
        }

        const contextJson = extractXmlTag(text, "inbox-context")
        if (contextJson) {
          try {
            return withRest(<ContextPanel data={JSON.parse(contextJson) as InboxContextData} />, "inbox-context")
          } catch {
            /* malformed payload — fall through to markdown */
          }
        }

        const resultJson = extractXmlTag(text, "inbox-result")
        if (resultJson) {
          try {
            return withRest(
              <InboxResultPanel data={JSON.parse(resultJson) as InboxResultData} sessionId={sessionId ?? ""} />,
              "inbox-result",
            )
          } catch {
            /* malformed payload — fall through to markdown */
          }
        }

        for (const [tag, widgets] of Object.entries(panelSchemas ?? {})) {
          const json = extractXmlTag(text, tag)
          if (!json) continue
          try {
            return withRest(
              <div className="rounded-lg border p-3 bg-card">
                <PanelWidget widgets={widgets} data={JSON.parse(json) as Record<string, unknown>} />
              </div>,
              tag,
            )
          } catch {
            /* malformed payload — fall through to markdown */
          }
        }

        return null
      },
    }),
    [panelSchemas],
  )
}
