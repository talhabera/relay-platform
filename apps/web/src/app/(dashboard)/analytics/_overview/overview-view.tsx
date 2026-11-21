import { MetricCard } from "@/components/shared/metric-card";
import { ChartCard } from "@/components/v2/data/chart-card";
import { BrandGlyph, Icon } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";

import type { CampaignRow, OverviewModel } from "./overview-model";

/** Shared card frame for the bottom row (radius/xl, elevation/1, space/5). */
const panel = "flex min-w-0 flex-col rounded-xl border border-border bg-card p-5 shadow-elevation-1";
const headCell = "type-label text-muted-foreground uppercase";

/** Marketing performance table (08b `411:39505`). */
export function CampaignTable({ title, rows }: { title: string; rows: CampaignRow[] }) {
  return (
    <section data-slot="campaign-table" className={cn(panel, "h-full overflow-x-auto")}>
      <h2 className="pb-2 type-h3 text-foreground">{title}</h2>
      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-start gap-1 py-6">
          <p className="type-body-strong text-foreground">No campaign activity this week</p>
          <p className="type-small text-muted-foreground">
            Lead engine outreach shows here once leads are contacted. Ad and post results follow with
            campaign tracking.
          </p>
        </div>
      ) : (
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr className="h-8 border-b border-border">
              <th scope="col" className={cn(headCell, "text-left")}>Campaign</th>
              <th scope="col" className={cn(headCell, "w-[150px] text-left")}>Channel</th>
              <th scope="col" className={cn(headCell, "w-[100px] text-right")}>Reached</th>
              <th scope="col" className={cn(headCell, "w-[110px] text-right")}>Responses</th>
              <th scope="col" className={cn(headCell, "w-20 text-right")}>Rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="h-10 border-b border-border">
                <td className="max-w-0 truncate type-body-strong text-foreground">{row.name}</td>
                <td>
                  <span className="flex items-center gap-2 type-body text-foreground">
                    <BrandGlyph brand={row.channel} />
                    {row.channelLabel}
                  </span>
                </td>
                <td className="text-right type-body text-foreground tabular-nums">{row.reached}</td>
                <td className="text-right type-body text-foreground tabular-nums">{row.responses}</td>
                <td
                  className={cn(
                    "text-right type-body tabular-nums",
                    row.rate ? "text-success" : "text-muted-foreground",
                  )}
                >
                  {row.rate ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Scheduled reports (08b `411:38858`): no report schedules exist yet, so the empty branch. */
export function ScheduledReports() {
  return (
    <section data-slot="scheduled-reports" className={cn(panel, "gap-2 lg:w-[400px] lg:shrink-0")}>
      <h2 className="type-h3 text-foreground">Scheduled reports</h2>
      <div className="flex items-center gap-3 rounded-lg bg-surface-raised px-3 py-2">
        <span className="flex rounded-lg bg-primary-soft p-2 text-primary-soft-foreground">
          <Icon name="file-text" size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="type-body-strong text-foreground">No scheduled reports yet</p>
          <p className="type-small text-muted-foreground">Report schedules for this company will list here.</p>
        </div>
      </div>
    </section>
  );
}

/** Analytics Overview body below the title row (08b `analytics/default`). */
export function OverviewView({ model, weekTitle }: { model: OverviewModel; weekTitle: string }) {
  return (
    <div data-slot="analytics-overview" className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {model.kpis.map((kpi) => (
          <MetricCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            description={kpi.description}
            trend={kpi.trend}
            emptyText={kpi.emptyText}
          />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {model.charts.map((chart) => (
          <ChartCard
            key={chart.title}
            title={chart.title}
            info={chart.info}
            value={chart.value}
            delta={chart.delta}
            comparison={chart.comparison}
            data={chart.data}
          />
        ))}
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <div className="min-w-0 flex-1">
          <CampaignTable title={`Marketing performance · ${weekTitle}`} rows={model.campaigns} />
        </div>
        <ScheduledReports />
      </div>
    </div>
  );
}
