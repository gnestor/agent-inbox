import { createContext, useContext } from "react"

interface HeaderNav {
  onTabSwipe?: (direction: 1 | -1) => void
  startOverlayDrag?: (event: PointerEvent) => void
  startTabDrag?: (event: PointerEvent) => void
}

export const HeaderNavContext = createContext<HeaderNav>({})
export const useHeaderNav = () => useContext(HeaderNavContext)
