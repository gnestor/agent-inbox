import { useNavigation } from "@/hooks/use-navigation"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PanelSlot } from "@/components/navigation/PanelSlot"
import { PanelContent } from "@/components/navigation/PanelContent"
import { SessionListView } from "./SessionListView"
import type { TabId, PanelState } from "@/types/navigation"

export function SessionTab({ tabId = "sessions" as TabId }: { tabId?: TabId }) {
  const { getPanels, getSelectedItemId } = useNavigation()
  const panels = getPanels(tabId)
  const listPanel = panels.find((p) => p.type === "list")
  const detailPanels = panels.filter((p) => p.type !== "list")
  const selectedId = getSelectedItemId(tabId)

  return (
    <Tab id={tabId}>
      {listPanel && (
        <Panel key="list" id="list" variant="list">
          <SessionListView />
        </Panel>
      )}
      {detailPanels.length > 0 && (
        <PanelSlot key="detail-group" panelId={selectedId ?? detailPanels[0].id} group>
          {detailPanels.map((panel) => (
            <Panel key={panel.id} id={panel.id} variant={panel.type}>
              {panel.type === "detail" && "itemId" in panel.props ? (
                <PanelContent panel={{ ...panel, type: "session", props: { sessionId: panel.props.itemId as string } } as PanelState} />
              ) : (
                <PanelContent panel={panel} />
              )}
            </Panel>
          ))}
        </PanelSlot>
      )}
    </Tab>
  )
}
