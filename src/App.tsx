import { Navigate, Route, Routes } from "react-router-dom"
import { SidebarInset, SidebarProvider } from "@hammies/frontend/components/ui"
import { useIsMobile } from "@hammies/frontend/hooks"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { LoginPage } from "@/components/layout/LoginPage"
import { PanelStack } from "@/components/layout/PanelStack"
import { SpatialNavProvider, getSavedPathname } from "@/hooks/use-spatial-nav"
import { UserContext, useUserProvider, useUser } from "@/hooks/use-user"

function AuthenticatedApp() {
  const isMobile = useIsMobile()
  return (
    <SpatialNavProvider isMobile={isMobile}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="max-h-svh overflow-hidden">
          <div className="flex flex-1 h-full">
            <Routes>
              <Route path="/" element={<Navigate to={getSavedPathname()} replace />} />
              <Route path="/*" element={<PanelStack />} />
            </Routes>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </SpatialNavProvider>
  )
}

function AppContent() {
  const { user, loading } = useUser()

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!user) return <LoginPage />

  return <AuthenticatedApp />
}

export function App() {
  const userContext = useUserProvider()

  return (
    <UserContext.Provider value={userContext}>
      <AppContent />
    </UserContext.Provider>
  )
}
