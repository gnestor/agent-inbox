import { Skeleton } from "@hammies/frontend/components/ui"

export function ListSkeleton({ itemHeight, count = 50 }: { itemHeight: number; count?: number }) {
  return (
    <div className="flex flex-col gap-px">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} style={{ height: itemHeight }} className="w-full rounded-none shrink-0" />
      ))}
    </div>
  )
}
