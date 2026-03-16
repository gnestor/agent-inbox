import { useLocation } from "react-router-dom"
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
import { ChevronsUpDown, LogOut, Settings } from "lucide-react"
import { useUser } from "@/hooks/use-user"
import { usePlugins } from "@/hooks/use-plugins"
import { useNavigation } from "@/hooks/use-navigation"
import type { TabId } from "@/types/navigation"

const navItems: { title: string; emoji: string; tab: TabId }[] = [
  { title: "Emails", emoji: "✉️", tab: "emails" },
  { title: "Tasks", emoji: "✅", tab: "tasks" },
  { title: "Calendar", emoji: "📅", tab: "calendar" },
]

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const location = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()
  const { user, logout } = useUser()
  const { switchTab } = useNavigation()
  const { data: plugins } = usePlugins()
  const isRecentRoute = location.pathname.startsWith("/recent/")

  return (
    <Sidebar variant="floating" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
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
                  <span className="truncate font-medium">Hammies</span>
                  <span className="truncate text-xs text-muted-foreground">Inbox</span>
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
                      <DropdownMenuLabel className="p-0 font-normal">
                        <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                          <Avatar className="h-8 w-8 rounded-lg">
                            {user.picture && <AvatarImage src={user.picture} alt={user.name} />}
                            <AvatarFallback className="rounded-lg">
                              {getInitials(user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="grid flex-1 text-left text-sm leading-tight">
                            <span className="truncate font-medium">{user.name}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {user.email}
                            </span>
                          </div>
                        </div>
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => {
                    switchTab("settings")
                    if (isMobile) setOpenMobile(false)
                  }}>
                    <Settings />
                    Integrations
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
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
        <SidebarGroup>
          <SidebarGroupLabel>Sources</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = !isRecentRoute && location.pathname.startsWith(`/${item.tab}`)
                return (
                  <SidebarMenuItem key={item.tab}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.title}
                      className={cn(isActive && "bg-accent text-accent-foreground font-medium")}
                      onClick={() => {
                        switchTab(item.tab)
                        if (isMobile) setOpenMobile(false)
                      }}
                    >
                      <span>{item.emoji}</span>
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {plugins && plugins.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Plugins</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {plugins.map((plugin) => {
                  const isActive = location.pathname.startsWith(`/plugins/${plugin.id}`)
                  return (
                    <SidebarMenuItem key={plugin.id}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={plugin.name}
                        className={cn(isActive && "bg-accent text-accent-foreground font-medium")}
                        onClick={() => {
                          switchTab(`plugin:${plugin.id}`)
                          if (isMobile) setOpenMobile(false)
                        }}
                      >
                        <span className="text-sm">🔌</span>
                        <span>{plugin.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarRecentSessions switchTab={switchTab} />
      </SidebarContent>
    </Sidebar>
  )
}
