import { useNavigation } from "@/hooks/use-navigation"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PanelSlot } from "@/components/navigation/PanelSlot"
import { PanelContent } from "@/components/navigation/PanelContent"
import { CalendarListView } from "./CalendarListView"
import { CalendarDetailView } from "./CalendarDetailView"
import { SessionView } from "@/components/session/SessionView"
import { NewSessionPanel } from "@/components/session/NewSessionPanel"

export function CalendarTab() {
  const { getPanels } = useNavigation()
  const panels = getPanels("calendar")

  return (
    <Tab id="calendar">
      {panels.map((panel, index) => {
        if (index === 0) {
          return (
            <Panel key="list" id="list" variant="list">
              <CalendarListView />
            </Panel>
          )
        }

        return (
          <PanelSlot key={panel.id} panelId={panel.id}>
            <Panel id={panel.id} variant={panel.type}>
              {panel.type === "detail" ? (
                <CalendarDetailView itemId={panel.props.itemId} />
              ) : panel.type === "session" && panel.props.sessionId !== "new" ? (
                <SessionView sessionId={panel.props.sessionId} />
              ) : panel.type === "session" && panel.props.sessionId === "new" ? (
                <NewSessionPanel taskId={panel.props.linkedItemId} />
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
