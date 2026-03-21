import { useNavigation } from "@/hooks/use-navigation"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PanelSlot } from "@/components/navigation/PanelSlot"
import { PanelContent } from "@/components/navigation/PanelContent"
import { EmailListView } from "./EmailListView"
import { EmailDetailView } from "./EmailDetailView"
import { SessionView } from "@/components/session/SessionView"
import { NewSessionPanel } from "@/components/session/NewSessionPanel"

export function EmailTab() {
  const { getPanels } = useNavigation()
  const panels = getPanels("emails")

  return (
    <Tab id="emails">
      {panels.map((panel, index) => {
        if (index === 0) {
          return (
            <Panel key="list" id="list" variant="list">
              <EmailListView />
            </Panel>
          )
        }

        return (
          <PanelSlot key={panel.id} panelId={panel.id}>
            <Panel id={panel.id} variant={panel.type}>
              {panel.type === "detail" ? (
                <EmailDetailView itemId={panel.props.itemId} />
              ) : panel.type === "session" && panel.props.sessionId !== "new" ? (
                <SessionView sessionId={panel.props.sessionId} />
              ) : panel.type === "session" && panel.props.sessionId === "new" ? (
                <NewSessionPanel threadId={panel.props.linkedItemId} />
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
