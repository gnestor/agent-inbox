import { useRef, useState, useMemo } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { SidebarRecentSessions } from "@/components/session/SidebarRecentSessions"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@hammies/frontend/components/ui"
import { cn } from "@hammies/frontend/lib/utils"
import { Check, ChevronsUpDown, LogOut, Settings } from "lucide-react"
import { icons as lucideIcons } from "lucide-react"
import { useUser } from "@/hooks/use-user"
import { usePlugins } from "@/hooks/use-plugins"
import { useNavigation } from "@/hooks/use-navigation"
import { usePreference } from "@/hooks/use-preferences"
import { getInitials } from "@/lib/formatters"
import type { TabId } from "@/types/navigation"
import { ACTIVE_TAB_CLASSES } from "@/lib/navigation-constants"

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const location = useLocation()
  const navigate = useNavigate()
  const { isMobile, setOpenMobile } = useSidebar()
  const { user, logout, activeWorkspace, workspaces, switchWorkspace } = useUser()
  const { switchTab, activeTab } = useNavigation()
  const savedUrls = useRef(new Map<string, string>())
  const [menuOpen, setMenuOpen] = useState(false)
  const { data: plugins } = usePlugins()
  const [pluginOrder, setPluginOrder] = usePreference<string[]>("pluginOrder", [])
  const dragItem = useRef<string | null>(null)

  // Sort plugins by user-defined order, preserving unordered ones at the end
  const sortedPlugins = useMemo(() => {
    if (!plugins || pluginOrder.length === 0) return plugins ?? []
    const orderMap = new Map(pluginOrder.map((id, i) => [id, i]))
    return [...plugins].sort((a, b) => {
      const ai = orderMap.get(a.id) ?? 999
      const bi = orderMap.get(b.id) ?? 999
      return ai - bi
    })
  }, [plugins, pluginOrder])

  return (
    <Sidebar variant="floating" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                  />
                }
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg">
                  <span className="text-lg">📥</span>
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{activeWorkspace?.name || "Inbox"}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {activeWorkspace?.role === "admin" ? "Admin" : "Member"}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--anchor-width] min-w-56 rounded-lg"
                side={isMobile ? "bottom" : "bottom"}
                align="start"
                sideOffset={4}
              >
                {user && (
                  <>
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="p-0 font-normal text-foreground">
                        <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                          <Avatar className="h-8 w-8">
                            {user.picture && <AvatarImage src={user.picture} alt={user.name} />}
                            <AvatarFallback>
                              {getInitials(user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="grid flex-1 text-left text-sm leading-tight">
                            <span className="truncate font-medium">{user.name}</span>
                            <span className="truncate text-xs">
                              {user.email}
                            </span>
                          </div>
                          <button
                            className="shrink-0 rounded-md p-1 hover:bg-secondary"
                            onClick={(e) => {
                              e.stopPropagation()
                              setMenuOpen(false)
                              switchTab("settings")
                              if (isMobile) setOpenMobile(false)
                            }}
                          >
                            <Settings className="size-3.5 text-muted-foreground" />
                          </button>
                        </div>
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                  </>
                )}
                {workspaces.length > 0 && (
                  <>
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
                      {workspaces.map((ws) => {
                        const isActive = ws.id === activeWorkspace?.id
                        const wsIsAdmin = ws.role === "admin"
                        return (
                          <DropdownMenuItem
                            key={ws.id}
                            onClick={() => {
                              if (!isActive) {
                                // Save current URL for this workspace
                                if (activeWorkspace) {
                                  savedUrls.current.set(activeWorkspace.id, location.pathname)
                                }
                                // Navigate to the target workspace's last URL (or root)
                                const targetUrl = savedUrls.current.get(ws.id) || "/"
                                navigate(targetUrl)
                                switchWorkspace(ws.id)
                              }
                            }}
                            className="flex items-center gap-2"
                          >
                            <Check className={cn("size-4 shrink-0", isActive ? "opacity-100" : "opacity-0")} />
                            <span className="flex-1 truncate">{ws.name}</span>
                            {isActive && wsIsAdmin && (
                              <button
                                className="shrink-0 rounded-md p-1 hover:bg-secondary"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setMenuOpen(false)
                                  switchTab("workspace-settings" as TabId)
                                  if (isMobile) setOpenMobile(false)
                                }}
                              >
                                <Settings className="size-3.5 text-muted-foreground" />
                              </button>
                            )}
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => logout()}>
                    <LogOut />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {sortedPlugins.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Sources</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {sortedPlugins.map((plugin) => {
                  const tabId: TabId = `plugin:${plugin.id}`
                  const isActive = activeTab === tabId
                  return (
                    <SidebarMenuItem
                      key={plugin.id}
                      draggable
                      onDragStart={() => { dragItem.current = plugin.id }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (!dragItem.current || dragItem.current === plugin.id) return
                        const ids = sortedPlugins.map((p) => p.id)
                        const fromIdx = ids.indexOf(dragItem.current)
                        const toIdx = ids.indexOf(plugin.id)
                        ids.splice(fromIdx, 1)
                        ids.splice(toIdx, 0, dragItem.current)
                        setPluginOrder(ids)
                        dragItem.current = null
                      }}
                      onDragEnd={() => { dragItem.current = null }}
                    >
                      <SidebarMenuButton
                        tooltip={plugin.name}
                        isActive={isActive}
                        data-tab-id={tabId}
                        className={isActive ? ACTIVE_TAB_CLASSES : ""}
                        onClick={() => {
                          switchTab(tabId)
                          if (isMobile) setOpenMobile(false)
                        }}
                      >
                        {(() => {
                          if (plugin.emoji) return <span>{plugin.emoji}</span>
                          const IconComponent = lucideIcons[plugin.icon as keyof typeof lucideIcons]
                          if (IconComponent) return <IconComponent className="h-4 w-4" />
                          return <span>🔌</span>
                        })()}
                        <span>{plugin.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarRecentSessions />
      </SidebarContent>
    </Sidebar>
  )
}
