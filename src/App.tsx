import { Navigate, Route, Routes } from "react-router-dom"
import {
  SidebarInset,
  SidebarProvider,
} from "@hammies/frontend/components/ui"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { LoginPage } from "@/components/layout/LoginPage"
import { PanelStack } from "@/components/layout/PanelStack"
import { UserContext, useUserProvider, useUser } from "@/hooks/use-user"

function AuthenticatedApp() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="max-h-svh overflow-hidden">
        <div className="flex flex-1 h-full overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/inbox" replace />} />
            <Route path="/inbox" element={<PanelStack />} />
            <Route path="/inbox/:threadId" element={<PanelStack />} />
            <Route path="/inbox/:threadId/session/new" element={<PanelStack />} />
            <Route path="/inbox/:threadId/session/:sessionId" element={<PanelStack />} />
            <Route path="/tasks" element={<PanelStack />} />
            <Route path="/tasks/:taskId" element={<PanelStack />} />
            <Route path="/tasks/:taskId/session/new" element={<PanelStack />} />
            <Route path="/tasks/:taskId/session/:sessionId" element={<PanelStack />} />
            <Route path="/sessions" element={<PanelStack />} />
            <Route path="/sessions/:sessionId" element={<PanelStack />} />
          </Routes>
        </div>
      </SidebarInset>
    </SidebarProvider>
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
