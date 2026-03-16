import { useContext } from "react"
import { useNavigation } from "@/hooks/use-navigation"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PanelSlot } from "@/components/navigation/PanelSlot"
import { PanelContent } from "@/components/navigation/PanelContent"
import { NavigationContext } from "@/components/navigation/NavigationProvider"
import { CalendarListView } from "./CalendarListView"
import { CalendarDetailView } from "./CalendarDetailView"
import { SessionView } from "@/components/session/SessionView"

export function CalendarTab() {
  const { getPanels } = useNavigation()
  const ctx = useContext(NavigationContext)
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
          <PanelSlot key={index} panelId={panel.id} directionRef={ctx!.itemDirectionRef}>
            <Panel id={panel.id} variant={panel.type}>
              {panel.type === "detail" ? (
                <CalendarDetailView itemId={panel.props.itemId} />
              ) : panel.type === "session" ? (
                <SessionView sessionId={panel.props.sessionId} />
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
