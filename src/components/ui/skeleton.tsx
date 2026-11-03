import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-surface-2", className)} />;
}

/** Generic placeholder for a streamed section (KPI row + one large panel). */
export function SectionSkeleton({ label, tiles = 4 }: { label: string; tiles?: number }) {
  return (
    <div role="status" aria-label={label} className="space-y-6">
      {tiles > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: tiles }, (_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-xl" />
          ))}
        </div>
      ) : null}
      <Skeleton className="h-72 rounded-xl" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
