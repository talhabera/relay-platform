import { MetricCard } from "@/components/shared/metric-card";
import { Skeleton } from "@/components/ui/skeleton";

const KPI_LABELS = [
  "Qualified leads delivered",
  "Lead quality score",
  "Cost per qualified lead",
  "Customer-agent conversations",
];

/** Overview skeleton in the 08b layout (title row, KPIs, charts, bottom row). */
export default function AnalyticsLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="type-h1 text-foreground">Analytics</h1>
          <Skeleton className="h-4.5 w-80" />
        </div>
        <Skeleton className="h-9 w-[421px] rounded-full" />
        <Skeleton className="h-10 w-[220px] rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPI_LABELS.map((label) => (
          <MetricCard key={label} label={label} loading />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[302px] w-full rounded-xl" />
        ))}
      </div>
      <div className="flex flex-col gap-4 lg:flex-row">
        <Skeleton className="h-[270px] min-w-0 flex-1 rounded-xl" />
        <Skeleton className="h-[270px] rounded-xl lg:w-[400px]" />
      </div>
    </div>
  );
}
