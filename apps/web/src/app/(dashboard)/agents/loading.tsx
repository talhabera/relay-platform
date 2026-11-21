import { Skeleton } from "@/components/ui/skeleton";

export default function AgentsLoading() {
  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-64 rounded-full" />
        <Skeleton className="h-9 w-48 rounded-lg" />
      </div>
      <div className="flex gap-30 rounded-xl bg-canvas p-4 max-lg:flex-col max-lg:gap-4 max-lg:bg-transparent max-lg:p-0">
        <Skeleton className="h-[700px] w-[332px] rounded-xl max-lg:h-40 max-lg:w-full" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-75 w-[360px] max-w-full rounded-xl" />
          <Skeleton className="h-75 w-[360px] max-w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
