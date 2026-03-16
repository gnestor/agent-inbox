import { PanelHeader, BackButton, SidebarButton } from "./PanelHeader"
import { PanelSkeleton } from "./PanelSkeleton"

interface DetailViewProps {
  title?: string
  loading?: boolean
  error?: string | null
  headerRight?: React.ReactNode
  onBack?: () => void
  isFromSidebar?: boolean
  children?: React.ReactNode
}

export function DetailView({
  title,
  loading,
  error,
  headerRight,
  onBack,
  isFromSidebar,
  children,
}: DetailViewProps) {
  const header = (
    <PanelHeader
      left={
        <>
          {isFromSidebar ? (
            <SidebarButton />
          ) : onBack ? (
            <BackButton onClick={onBack} />
          ) : (
            <SidebarButton />
          )}
          {title && (
            <h2 className="font-semibold text-sm truncate min-w-0">{title}</h2>
          )}
        </>
      }
      right={headerRight}
    />
  )

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <PanelSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="p-6 text-destructive text-sm">Error: {error}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {header}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
