import { useNavigation } from "@/hooks/use-navigation"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PanelSlot } from "@/components/navigation/PanelSlot"
import { PanelContent } from "@/components/navigation/PanelContent"
import { CalendarListView } from "./CalendarListView"
import { CalendarDetailView } from "./CalendarDetailView"
import { SessionView } from "@/components/session/SessionView"
import { NewSessionPanel } from "@/components/session/NewSessionPanel"
import type { TabId } from "@/types/navigation"

export function CalendarTab({ tabId = "plugin:notion-calendar" as TabId }: { tabId?: TabId }) {
  const { getPanels, getSelectedItemId } = useNavigation()
  const panels = getPanels(tabId)
  const listPanel = panels.find((p) => p.type === "list")
  const detailPanels = panels.filter((p) => p.type !== "list")
  const selectedId = getSelectedItemId(tabId)

  return (
    <Tab id={tabId}>
      {listPanel && (
        <Panel key="list" id="list" variant="list">
          <CalendarListView />
        </Panel>
      )}
      {detailPanels.length > 0 && selectedId && (
        <PanelSlot key="detail-group" panelId={selectedId} group>
          {detailPanels.map((panel) => (
            <Panel key={panel.id} id={panel.id} variant={panel.type}>
              {panel.type === "detail" ? (
                <CalendarDetailView itemId={panel.props.itemId} />
              ) : panel.type === "session" && panel.props.sessionId !== "new" ? (
                <SessionView sessionId={panel.props.sessionId} panelId={panel.id} />
              ) : panel.type === "session" && panel.props.sessionId === "new" ? (
                <NewSessionPanel panelId={panel.id} taskId={panel.props.linkedItemId} />
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
