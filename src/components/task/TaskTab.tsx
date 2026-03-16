import { useContext } from "react"
import { useNavigation } from "@/hooks/use-navigation"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PanelSlot } from "@/components/navigation/PanelSlot"
import { PanelContent } from "@/components/navigation/PanelContent"
import { NavigationContext } from "@/components/navigation/NavigationProvider"
import { TaskListView } from "./TaskListView"
import { TaskDetailView } from "./TaskDetailView"
import { SessionView } from "@/components/session/SessionView"
import { NewSessionPanel } from "@/components/session/NewSessionPanel"

export function TaskTab() {
  const { getPanels } = useNavigation()
  const ctx = useContext(NavigationContext)
  const panels = getPanels("tasks")

  return (
    <Tab id="tasks">
      {panels.map((panel, index) => {
        if (index === 0) {
          return (
            <Panel key="list" id="list" variant="list">
              <TaskListView />
            </Panel>
          )
        }

        return (
          <PanelSlot key={index} panelId={panel.id} directionRef={ctx!.itemDirectionRef}>
            <Panel id={panel.id} variant={panel.type}>
              {panel.type === "detail" ? (
                <TaskDetailView itemId={panel.props.itemId} />
              ) : panel.type === "session" && panel.props.sessionId !== "new" ? (
                <SessionView sessionId={panel.props.sessionId} />
              ) : panel.type === "session" && panel.props.sessionId === "new" ? (
                <NewSessionPanel />
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
