// src/components/navigation/PanelSlot.tsx
import { useRef, useEffect, useState } from "react"
import { motion, AnimatePresence, usePresence } from "motion/react"
import { EASE, DURATION, ITEM_GAP } from "@/lib/navigation-constants"

interface PanelSlotProps {
  panelId: string
  directionRef: React.RefObject<number>
  children: React.ReactNode
}

const slotVariants = {
  enter: (direction: number) => ({
    y: direction > 0 ? `calc(100% + ${ITEM_GAP}px)` : `calc(-100% - ${ITEM_GAP}px)`,
    opacity: 0.5,
  }),
  center: { y: 0, opacity: 1 },
}

function computeExit(direction: number) {
  return {
    y: direction > 0 ? `calc(-100% - ${ITEM_GAP}px)` : `calc(100% + ${ITEM_GAP}px)`,
    opacity: 0.5,
  }
}

function AnimatedSlot({
  children,
  entryDirection,
  directionRef,
}: {
  children: React.ReactNode
  entryDirection: number
  directionRef: React.RefObject<number>
}) {
  const [isPresent, safeToRemove] = usePresence()
  const safeRef = useRef(safeToRemove)
  safeRef.current = safeToRemove

  const [target, setTarget] = useState(slotVariants.center)

  useEffect(() => {
    if (!isPresent) {
      setTarget(computeExit(directionRef.current))
      const timer = setTimeout(() => safeRef.current?.(), DURATION * 1000 + 50)
      return () => clearTimeout(timer)
    }
  }, [isPresent, directionRef])

  return (
    <motion.div
      initial={slotVariants.enter(entryDirection)}
      animate={target}
      transition={{ duration: DURATION, ease: EASE }}
      className="absolute inset-0"
    >
      {children}
    </motion.div>
  )
}

export function PanelSlot({ panelId, directionRef, children }: PanelSlotProps) {
  const prevIdRef = useRef(panelId)
  const entryDirectionRef = useRef(0)

  if (panelId !== prevIdRef.current) {
    entryDirectionRef.current = directionRef.current
    prevIdRef.current = panelId
  }

  return (
    <div className="relative h-full overflow-clip" style={{ contain: "strict" }}>
      <AnimatePresence initial={false}>
        <AnimatedSlot
          key={panelId}
          entryDirection={entryDirectionRef.current}
          directionRef={directionRef}
        >
          {children}
        </AnimatedSlot>
      </AnimatePresence>
    </div>
  )
}
