import { createContext, useContext, useState, type ReactNode } from "react"

interface HeaderMenuContextValue {
  menu: ReactNode
  setMenu: (menu: ReactNode) => void
}

const HeaderMenuContext = createContext<HeaderMenuContextValue>({
  menu: null,
  setMenu: () => {},
})

export function HeaderMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<ReactNode>(null)
  return (
    <HeaderMenuContext.Provider value={{ menu, setMenu }}>
      {children}
    </HeaderMenuContext.Provider>
  )
}

export function useHeaderMenu() {
  return useContext(HeaderMenuContext)
}
