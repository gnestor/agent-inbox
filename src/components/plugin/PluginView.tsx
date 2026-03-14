import { useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { AnimatePresence, motion } from "motion/react"
import { PANEL_CARD, EASE, DURATION } from "@/components/layout/PanelStack"
import { PluginList } from "@/components/plugin/PluginList"
import { PluginDetail } from "@/components/plugin/PluginDetail"

export function PluginView() {
  const { id, "*": rest } = useParams<{ id: string; "*": string }>()
  const itemId = rest ? rest.split("/")[0] : undefined

  const [selectedTitle, setSelectedTitle] = useState("")
  const directionRef = useRef(1)
  const prevIndexRef = useRef(-1)

  function handleIndexChange(index: number) {
    if (prevIndexRef.current >= 0 && index !== prevIndexRef.current) {
      directionRef.current = index > prevIndexRef.current ? 1 : -1
    }
    prevIndexRef.current = index
  }

  return (
    <div className="flex flex-row h-full gap-4 shrink-0 overflow-y-hidden overflow-x-auto py-4 pr-4 pl-[var(--sidebar-width)]">
      <div className={PANEL_CARD}>
        <PluginList
          selectedItemId={itemId}
          onSelectedIndexChange={handleIndexChange}
          onSelectedTitleChange={setSelectedTitle}
        />
      </div>
      <AnimatePresence>
        {itemId && id && (
          <motion.div
            key={itemId}
            className={`${PANEL_CARD} flex flex-col`}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION, ease: EASE }}
          >
            <PluginDetail pluginId={id} itemId={itemId} parentTitle={selectedTitle} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
