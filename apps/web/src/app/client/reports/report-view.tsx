import * as React from "react";

import { ChartCard } from "@/components/v2/data/chart-card";
import { Icon, type IconName } from "@/components/v2/primitives";
import type { ReportPeriod } from "@/lib/fixtures/interfaces";
import type { ReportStatCard, ReportView } from "@/lib/reports/view";
import { cn } from "@/lib/utils";

const PERIOD_NOUN: Record<ReportPeriod, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
};

const ALSO_ICON: Partial<Record<ReportStatCard["metricKey"], IconName>> = {
  "conversations.started": "messages-square",
  "leads.inbound": "inbox",
  "handoff.staff_answers": "message-square",
};

function Card({ className, slot, children }: { className?: string; slot: string; children: React.ReactNode }) {
  return (
    <section
      data-slot={slot}
      className={cn("flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-elevation-1", className)}
    >
      {children}
    </section>
  );
}

function StatCard({ card }: { card: ReportStatCard }) {
  return (
    <Card slot="report-stat" className="flex-1 gap-2">
      <span data-metric={card.metricKey} className="type-label text-muted-foreground">
        {card.label}
      </span>
      <span className="type-metric text-foreground">{card.value}</span>
      {card.caption ? (
        <span
          data-slot="report-stat-caption"
          className={cn("type-caption", card.caption.startsWith("Up from") ? "text-primary" : "text-muted-foreground")}
        >
          {card.caption}
        </span>
      ) : null}
    </Card>
  );
}

function GoalCard({ icon, title, value, suffix, caption }: { icon: IconName; title: string; value: string; suffix?: string; caption?: string }) {
  return (
    <Card slot="report-goal" className="flex-1 flex-row items-start gap-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon name={icon} size={20} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="type-small text-muted-foreground">{title}</span>
        <div className="flex items-baseline gap-1 whitespace-nowrap">
          <span className="type-metric text-foreground">{value}</span>
          {suffix ? <span className="type-h3 text-muted-foreground">{suffix}</span> : null}
        </div>
        {caption ? <span className="type-caption text-muted-foreground">{caption}</span> : null}
      </div>
    </Card>
  );
}

function Narrative({ summary, highlights }: { summary: string | null; highlights: string[] }) {
  if (!summary && highlights.length === 0) return null;
  return (
    <Card slot="report-summary">
      <span className="flex items-center gap-2 type-label text-muted-foreground">
        <Icon name="sparkles" size={16} className="text-primary" />
        Summary
      </span>
      {summary ? <p className="type-body text-foreground">{summary}</p> : null}
      {highlights.length > 0 ? (
        <ul data-slot="report-highlights" className="flex list-disc flex-col gap-1 pl-5 type-body text-foreground">
          {highlights.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function AlsoCard({ also }: { also: NonNullable<ReportView["also"]> }) {
  return (
    <Card slot="report-also">
      <h3 className="type-body-strong text-foreground">{also.title}</h3>
      <ul className="flex flex-col divide-y divide-border">
        {also.rows.map((row) => (
          <li key={row.metricKey} data-metric={row.metricKey} className="flex items-center gap-3 py-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
              <Icon name={ALSO_ICON[row.metricKey] ?? "activity"} size={16} />
            </span>
            <span className="min-w-0 flex-1 type-body-strong text-foreground">{row.label}</span>
            <span className="type-h3 text-foreground">{row.value}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Monthly full-width Highlights card (Figma `card/highlights`). */
function Highlights({ summary, highlights }: { summary: string | null; highlights: string[] }) {
  if (!summary && highlights.length === 0) return null;
  return (
    <Card slot="report-summary">
      <span className="flex items-center gap-2 type-label text-muted-foreground">
        <Icon name="sparkles" size={16} className="text-primary" />
        Highlights
      </span>
      {summary ? <p className="type-body text-foreground">{summary}</p> : null}
      {highlights.length > 0 ? (
        <ul data-slot="report-highlights" className="grid grid-cols-1 gap-4 type-body text-foreground sm:grid-cols-2 lg:grid-cols-4">
          {highlights.map((h, i) => (
            <li key={i} className="flex items-start gap-2">
              <Icon name="circle-check" size={16} className="mt-0.5 shrink-0 text-primary" />
              <span>{h}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function FunnelChart({ view }: { view: ReportView }) {
  if (!view.funnel) return null;
  return (
    <ChartCard
      title={`Lead engine · ${view.shortRangeLabel}`}
      info="Leads that reached each stage in this period"
      value={String(view.funnel.delivered)}
      comparison={`${view.funnel.gathered} → ${view.funnel.delivered} gathered to delivered`}
      data={{ type: "funnel", stages: view.funnel.stages }}
    />
  );
}

function DeliveredChart({ view }: { view: ReportView }) {
  if (!view.deliveredSeries) return null;
  return (
    <ChartCard
      title={view.deliveredSeries.title}
      info="Qualified leads delivered, counted once per lead"
      value={String(view.deliveredSeries.total)}
      comparison="qualified leads"
      data={{ type: "bar", points: view.deliveredSeries.points }}
    />
  );
}

/** A period with no closed snapshot yet, or one whose cards all lack a source. */
export function ReportEmpty({ period, hasSnapshot }: { period: ReportPeriod; hasSnapshot: boolean }) {
  return (
    <Card slot="report-empty" className="items-center py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon name="file-text" size={20} />
      </span>
      <h2 className="type-h3 text-foreground">
        {hasSnapshot ? "Nothing to report for this period" : `No ${PERIOD_NOUN[period]} report yet`}
      </h2>
      <p className="type-small text-muted-foreground">
        {hasSnapshot
          ? "None of the numbers in this report have a data source yet."
          : "A report appears here once its period closes."}
      </p>
    </Card>
  );
}

/**
 * Body of a closed daily / weekly / monthly report (Figma 11a). Renders only
 * the cards the view model carries; sourceless cards are absent upstream.
 */
export function ReportBody({ view }: { view: ReportView }) {
  if (view.empty) return <ReportEmpty period={view.period} hasSnapshot />;

  if (view.period === "daily") {
    return (
      <div data-slot="report-body" data-period="daily" className="flex flex-col gap-6">
        {view.headline.length > 0 ? (
          <div data-slot="report-headline" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {view.headline.map((card) => (
              <StatCard key={card.metricKey} card={card} />
            ))}
          </div>
        ) : null}
        <Narrative summary={view.summary} highlights={view.highlights} />
      </div>
    );
  }

  if (view.period === "monthly") {
    return (
      <div data-slot="report-body" data-period="monthly" className="flex flex-col gap-6">
        {view.headline.length > 0 ? (
          <div data-slot="report-headline" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {view.headline.map((card) => (
              <StatCard key={card.metricKey} card={card} />
            ))}
          </div>
        ) : null}
        {view.deliveredSeries || view.funnel || view.also ? (
          <div data-slot="report-charts" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <DeliveredChart view={view} />
            <FunnelChart view={view} />
            {view.also ? <AlsoCard also={view.also} /> : null}
          </div>
        ) : null}
        <Highlights summary={view.summary} highlights={view.highlights} />
      </div>
    );
  }

  return (
    <div data-slot="report-body" data-period={view.period} className="flex flex-col gap-6">
      {view.delivered || view.quality ? (
        <div data-slot="report-goals" className="flex flex-col gap-4 md:flex-row">
          {view.delivered ? <GoalCard icon="users" title={view.delivered.title} value={view.delivered.value} /> : null}
          {view.quality ? (
            <GoalCard
              icon="gauge"
              title="Lead quality score"
              value={view.quality.value}
              suffix="/ 100"
              caption="Average fit score of qualified leads"
            />
          ) : null}
        </div>
      ) : null}
      {view.funnel || view.deliveredSeries ? (
        <div data-slot="report-charts" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <FunnelChart view={view} />
          <DeliveredChart view={view} />
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Narrative summary={view.summary} highlights={view.highlights} />
        {view.also ? <AlsoCard also={view.also} /> : null}
      </div>
    </div>
  );
}
