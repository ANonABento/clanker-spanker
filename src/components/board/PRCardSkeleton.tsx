import { Skeleton } from "@/components/ui/skeleton";

export function PRCardSkeleton() {
  return (
    <div className="rounded-lg border border-[#1f1f1f] bg-[#111] p-3 space-y-2">
      {/* Header Row: PR#, Repo, Status Dots */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-4 w-16 rounded" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className="h-2 w-2 rounded-full" />
        </div>
      </div>

      {/* Title - single line */}
      <Skeleton className="h-4 w-full" />

      {/* Meta row */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-12" />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-7 flex-1 rounded" />
        <Skeleton className="h-7 w-9 rounded" />
      </div>
    </div>
  );
}
