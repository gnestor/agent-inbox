import { useNavigation } from "@/hooks/use-navigation"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PanelSlot } from "@/components/navigation/PanelSlot"
import { PanelContent } from "@/components/navigation/PanelContent"
import { SessionListView } from "./SessionListView"
import { SessionView } from "./SessionView"
import type { TabId } from "@/types/navigation"

export function SessionTab({ tabId = "sessions" as TabId }: { tabId?: TabId }) {
  const { getPanels } = useNavigation()
  const panels = getPanels(tabId)

  return (
    <Tab id={tabId}>
      {panels.map((panel, index) => {
        if (panel.type === "list") {
          return (
            <Panel key="list" id="list" variant="list">
              <SessionListView />
            </Panel>
          )
        }

        return (
          <PanelSlot key={index} panelId={panel.id}>
            <Panel id={panel.id} variant={panel.type}>
              {panel.type === "session" ? (
                <SessionView sessionId={panel.props.sessionId} />
              ) : panel.type === "detail" && "itemId" in panel.props ? (
                <SessionView sessionId={panel.props.itemId as string} />
              ) : (
                <PanelContent panel={panel} />
              )}
            </Panel>
          </PanelSlot>
        )
      })}
    </Tab>
  )
}
