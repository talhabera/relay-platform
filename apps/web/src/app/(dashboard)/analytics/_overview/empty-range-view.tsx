import { CalendarDays } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { MetricCard } from "@/components/shared/metric-card";

/** Empty-range state (08b `412:38653`): dashed KPIs and one empty card. */
export function EmptyRangeView({
  kpiLabels,
  title,
  description,
  backHref,
}: {
  kpiLabels: readonly string[];
  title: string;
  description: string;
  /** "Back to this week" target; null when this week is already selected. */
  backHref: string | null;
}) {
  return (
    <div data-slot="analytics-empty-range" className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiLabels.map((label) => (
          <MetricCard key={label} label={label} value={null} emptyText="No data for this range yet" />
        ))}
      </div>
      <section className="flex min-h-[420px] items-center justify-center rounded-xl border border-border bg-card p-5 shadow-elevation-1">
        <EmptyState
          icon={CalendarDays}
          title={title}
          description={description}
          action={backHref ? { label: "Back to this week", href: backHref } : undefined}
        />
      </section>
    </div>
  );
}
