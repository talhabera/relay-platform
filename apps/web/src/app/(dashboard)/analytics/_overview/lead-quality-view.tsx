import { MetricCard } from "@/components/shared/metric-card";
import { ProgressBar } from "@/components/v2/primitives";
import { LeadRow, LeadRowHeader } from "@/components/v2/work/lead-row";
import { cn } from "@/lib/utils";

import {
  LEAD_QUALITY_LIST_LIMIT,
  leadListFooter,
  rejectedSubtitle,
  type LeadQualityModel,
} from "./lead-quality-model";

/** Shared card frame (radius/xl, elevation/1, space/5), as on the Overview. */
const panel = "flex min-w-0 flex-col rounded-xl border border-border bg-card p-5 shadow-elevation-1";

/**
 * Analytics is read-only: the Lead row's select checkbox and row menu (lead
 * actions live in the operator session's Leads pane) are hidden here.
 */
const readOnlyRows =
  "[&_[data-slot=lead-row]>:first-child]:hidden [&_[data-slot=lead-row]>:last-child]:hidden";

/** Qualified leads this week, best fit first (08b `411:40777`). */
export function QualifiedLeadsCard({ model }: { model: LeadQualityModel }) {
  const shown = model.rows.slice(0, LEAD_QUALITY_LIST_LIMIT);
  return (
    <section data-slot="qualified-leads" className={cn(panel, "gap-1")}>
      <h2 className="type-h3 text-foreground">Qualified leads this week · by fit score</h2>
      <p className="type-small text-muted-foreground">
        Every lead is scored 0-100 against the company&apos;s criteria: 70 or more qualifies, 50-69 is
        borderline and waits for a person.
      </p>
      {shown.length === 0 ? (
        <div className="flex flex-col items-start gap-1 py-6">
          <p className="type-body-strong text-foreground">No qualified leads this week</p>
          <p className="type-small text-muted-foreground">
            Leads show here once the Lead engine or a customer agent qualifies them.
          </p>
        </div>
      ) : (
        <>
          <div role="table" aria-label="Qualified leads" className={cn("mt-3 overflow-x-auto", readOnlyRows)}>
            <LeadRowHeader />
            {shown.map((row) => (
              <LeadRow
                key={row.id}
                company={row.company}
                companyMeta={row.companyMeta}
                contactName={row.contactName}
                contactMeta={row.contactMeta}
                fitScore={row.fitScore}
                reasons={row.reasons}
                borderline={row.borderline}
              />
            ))}
          </div>
          <p className="pt-4 type-small text-muted-foreground">{leadListFooter(model, shown.length)}</p>
        </>
      )}
    </section>
  );
}

/** Rejected this week, by reject reason (08b `412:6093`). */
export function RejectedCard({ model }: { model: LeadQualityModel }) {
  return (
    <section data-slot="rejected-reasons" className={cn(panel, "gap-1")}>
      <h2 className="type-h3 text-foreground">Rejected this week</h2>
      <p className="type-small text-muted-foreground">{rejectedSubtitle(model)}</p>
      {model.rejected.reasons.length === 0 ? (
        <p className="pt-3 type-small text-muted-foreground">No leads were rejected this week.</p>
      ) : (
        <ul className="flex flex-col gap-4 pt-3">
          {model.rejected.reasons.map((r) => (
            <li key={r.label} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate type-body text-foreground">{r.label}</span>
                <span className="shrink-0 type-small text-muted-foreground tabular-nums">
                  {r.count} · {r.pct}%
                </span>
              </div>
              <ProgressBar value={r.count} max={model.rejected.total} aria-label={`${r.label}: ${r.pct}%`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Analytics Lead quality body below the title row (08b `analytics/lead-quality`). */
export function LeadQualityView({ model }: { model: LeadQualityModel }) {
  return (
    <div data-slot="analytics-lead-quality" className="flex flex-col gap-4">
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <QualifiedLeadsCard model={model} />
        </div>
        <div className="flex flex-col gap-4 lg:w-[400px] lg:shrink-0">
          <RejectedCard model={model} />
        </div>
      </div>
    </div>
  );
}
