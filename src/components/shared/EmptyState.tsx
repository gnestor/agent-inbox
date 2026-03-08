export function EmptyState({ icon: Icon, message }: { icon?: React.ElementType; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-muted-foreground">
      {Icon && <Icon className="h-8 w-8 mb-2" />}
      <p className="text-sm">{message}</p>
    </div>
  )
}
