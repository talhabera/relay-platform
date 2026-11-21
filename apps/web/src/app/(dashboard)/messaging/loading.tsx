import { Skeleton } from "@/components/ui/skeleton";

const card = "flex min-h-0 flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-elevation-1";

export default function MessagingLoading() {
  return (
    <div className="flex h-full min-h-0 gap-4 px-4 pb-4 md:px-6 md:pb-6" aria-busy="true">
      <div className={`${card} w-full lg:w-96 lg:shrink-0 xl:w-108`}>
        <Skeleton className="h-9 w-full rounded-full" />
        <div className="flex gap-2">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 w-38" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-25 w-full rounded-xl" />
        ))}
      </div>
      <div className={`${card} hidden min-w-0 flex-1 p-6 lg:flex`}>
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-20 w-full rounded-xl" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className={`h-16 w-2/3 rounded-xl ${i % 2 ? "self-end" : ""}`} />
        ))}
      </div>
      <div className="hidden w-84 shrink-0 flex-col gap-4 xl:flex">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    </div>
  );
}
