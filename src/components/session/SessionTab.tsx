import { useNavigation } from "@/hooks/use-navigation"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PanelSlot } from "@/components/navigation/PanelSlot"
import { PanelContent } from "@/components/navigation/PanelContent"
import { SessionListView } from "./SessionListView"
import { SessionView } from "./SessionView"

export function SessionTab() {
  const { getPanels } = useNavigation()
  const panels = getPanels("sessions")

  return (
    <Tab id="sessions">
      {panels.map((panel, index) => {
        // Slot 0 (list) doesn't need item animation
        if (index === 0) {
          return (
            <Panel key="list" id="list" variant="list">
              <SessionListView />
            </Panel>
          )
        }

        // Other slots get PanelSlot for item-change animation
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
