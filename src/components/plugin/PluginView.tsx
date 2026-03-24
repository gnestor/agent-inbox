import { useNavigation } from "@/hooks/use-navigation"
import { Tab } from "@/components/navigation/Tab"
import { Panel } from "@/components/navigation/Panel"
import { PanelSlot } from "@/components/navigation/PanelSlot"
import { PanelContent } from "@/components/navigation/PanelContent"
import { PluginList } from "@/components/plugin/PluginList"
import { PluginDetail } from "@/components/plugin/PluginDetail"
import { SessionView } from "@/components/session/SessionView"
import { NewSessionPanel } from "@/components/session/NewSessionPanel"
import type { TabId } from "@/types/navigation"

export function PluginView() {
  const { activeTab, getPanels, getSelectedItemId } = useNavigation()
  const tabId = activeTab as TabId
  const pluginId = activeTab.startsWith("plugin:") ? activeTab.replace("plugin:", "") : undefined
  const panels = getPanels(tabId)
  const listPanel = panels.find((p) => p.type === "list")
  const detailPanels = panels.filter((p) => p.type !== "list")
  const selectedId = getSelectedItemId(tabId)

  return (
    <Tab id={tabId}>
      {listPanel && (
        <Panel key="list" id="list" variant="list">
          <PluginList pluginId={pluginId} />
        </Panel>
      )}
      {detailPanels.length > 0 && (
        <PanelSlot key="detail-group" panelId={selectedId ?? detailPanels[0].id} group>
          {detailPanels.map((panel) => (
            <Panel key={panel.id} id={panel.id} variant={panel.type}>
              {panel.type === "detail" && pluginId ? (
                <PluginDetail pluginId={pluginId} itemId={panel.props.itemId} />
              ) : panel.type === "session" ? (
                <SessionView sessionId={panel.props.sessionId} panelId={panel.id} />
              ) : panel.type === "new_session" ? (
                <NewSessionPanel />
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
