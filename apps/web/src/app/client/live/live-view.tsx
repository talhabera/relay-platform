import Link from "next/link";

import { MetricCard } from "@/components/shared/metric-card";
import { BrandGlyph } from "@/components/v2/primitives/brand-glyph";
import { Icon } from "@/components/v2/primitives/icon";
import { GoalStrip } from "@/components/v2/work/goal-strip";
import { formatCostPerLead } from "@/app/(dashboard)/operator/_overview/overview-model";
import type { LiveSummary } from "@/lib/live/summary";
import { cn } from "@/lib/utils";

import {
  formatLiveStamp,
  formatWaited,
  formatWeekLabel,
  hourlyView,
  sourcesView,
  type HourlyView,
  type SourceRowView,
} from "./live-model";
import type { WaitingOldest } from "./load-live";

const CARD = "rounded-xl border border-border bg-card shadow-elevation-1";

/** Figma 11b `title row`: live dot, Live, stamp. The "N live now" chip has no source yet. */
export function LiveTitle({ generatedAt, timeZone }: { generatedAt: Date; timeZone: string }) {
  return (
    <div data-slot="live-title" className="flex w-full items-center gap-4 pt-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-3">
          <span aria-hidden className="relative flex size-5 items-center justify-center">
            <span className="absolute size-5 rounded-full bg-status-live" />
            <span className="relative size-2.5 rounded-full bg-primary" />
          </span>
          <h1 className="type-h1 text-foreground">Live</h1>
          <span className="type-body text-muted-foreground">· updated just now</span>
        </div>
        <p className="type-small text-muted-foreground">
          {formatLiveStamp(generatedAt, timeZone)} · what your customer agents are doing right now
        </p>
      </div>
    </div>
  );
}

/** Goal strip from the week-to-date KPIs; hidden without a weekly target (as on Home). */
export function LiveGoalStrip({ summary }: { summary: LiveSummary }) {
  const { week } = summary;
  if (!week.target) return null;
  return (
    <GoalStrip
      weekLabel={formatWeekLabel(week.range, summary.timeZone)}
      delivered={week.target.value}
      target={week.target.weeklyTarget}
      quality={week.qualityScore}
      costPerLead={formatCostPerLead(week.costPerQualifiedLead?.estimatedUsdPerLead)}
    />
  );
}

/**
 * Figma 11b `today metrics`. Only cards with a source: conversations, qualified
 * inbound leads, waiting for staff (opens the oldest waiting conversation).
 */
export function TodayMetrics({
  summary,
  waitingOldest,
  waitingHref,
  now,
}: {
  summary: LiveSummary;
  waitingOldest: WaitingOldest | null;
  waitingHref: string | null;
  now: Date;
}) {
  const { today } = summary;
  const waiting = today.waitingForStaff;
  const waitingText =
    waiting.count === 0
      ? "Nobody is waiting"
      : waitingOldest
        ? `${waitingOldest.customer} · ${formatWaited(waitingOldest.since, now)}`
        : waiting.oldestAt
          ? `Oldest · ${formatWaited(waiting.oldestAt, now)}`
          : "Open handoffs";
  const waitingCard = (
    <MetricCard label="Waiting for staff" value={String(waiting.count)} description={waitingText} />
  );
  return (
    <div data-slot="live-today" className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
      <MetricCard
        label="Conversations today"
        value={String(today.conversations)}
        description="Since 00:00 · all sources"
      />
      <MetricCard
        label="Qualified inbound leads"
        value={String(today.inboundQualified)}
        description="From customer-agent chats"
      />
      {waitingHref && waiting.count > 0 ? (
        <Link
          href={waitingHref}
          scroll={false}
          data-slot="live-waiting-link"
          className="rounded-xl outline-none focus-visible:shadow-focus-ring"
        >
          {waitingCard}
        </Link>
      ) : (
        waitingCard
      )}
    </div>
  );
}

function HourlyCardView({ view }: { view: HourlyView }) {
  return (
    <section data-slot="live-hourly" className={cn(CARD, "flex min-h-72 flex-1 flex-col gap-2 p-4")}>
      <div className="flex items-center gap-2">
        <h2 className="type-body-strong text-foreground">Conversations by hour</h2>
        <span className="flex-1" />
        <span className="type-caption text-muted-foreground">{view.range}</span>
      </div>
      <p className="type-small text-muted-foreground">{view.summary}</p>
      <div className="flex min-h-40 flex-1 items-end gap-2" role="list" aria-label="Conversations by hour">
        {view.bars.map((bar) => (
          <div
            key={bar.label}
            role="listitem"
            aria-label={`${bar.label}:00, ${bar.value}`}
            data-busiest={bar.busiest || undefined}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
          >
            {bar.value > 0 ? (
              <span className={cn("type-caption", bar.busiest ? "text-primary" : "text-muted-foreground")}>
                {bar.value}
              </span>
            ) : null}
            <div className="flex w-full flex-1 items-end">
              {bar.value > 0 ? (
                <div
                  className={cn("w-full rounded-t-sm", bar.busiest ? "bg-primary" : "bg-chart-1")}
                  style={{ height: `${bar.pct}%` }}
                />
              ) : (
                <div className="h-0.5 w-full bg-muted" />
              )}
            </div>
            <span className={cn("type-mono", bar.busiest ? "text-primary" : "text-muted-foreground")}>
              {bar.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SourcesCardView({ rows, total }: { rows: SourceRowView[]; total: number }) {
  return (
    <section data-slot="live-sources" className={cn(CARD, "flex flex-col gap-2 p-4")}>
      <div className="flex items-center gap-2">
        <h2 className="type-body-strong text-foreground">Sources today</h2>
        <span className="flex-1" />
        <span className="type-caption text-muted-foreground">
          {total} {total === 1 ? "conversation" : "conversations"}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="type-small text-muted-foreground">No conversations yet today.</p>
      ) : (
        rows.map((row) => (
          <div key={row.source} data-source={row.source} className="flex items-center gap-3">
            <BrandGlyph brand={row.brand} size={16} />
            <span className="w-28 shrink-0 type-small text-foreground">{row.label}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-2 rounded-full bg-chart-1" style={{ width: `${row.pct}%` }} />
            </div>
            <span className="w-6 shrink-0 text-right type-body-strong text-foreground">{row.value}</span>
          </div>
        ))
      )}
    </section>
  );
}

/** Figma 11b `main` / `mid`: Conversations by hour over Sources today. */
export function LiveCharts({ summary }: { summary: LiveSummary }) {
  const { today } = summary;
  return (
    <div data-slot="live-charts" className="flex min-w-0 flex-1 flex-col gap-4">
      <HourlyCardView view={hourlyView(today.hourly, summary.generatedAt, summary.timeZone)} />
      <SourcesCardView rows={sourcesView(today.sources)} total={today.conversations} />
    </div>
  );
}

/** Figma 11b `11/live/preview` `preview bar` (owner / member read-only preview). */
export function PreviewBar({ companyName, exitHref }: { companyName: string; exitHref: string }) {
  return (
    <div
      data-slot="live-preview-bar"
      className="flex w-full flex-wrap items-center gap-3 border-b border-status-needs-you bg-surface-raised px-6 py-2.5"
    >
      <Icon name="eye" size={16} className="text-foreground" />
      <span className="type-body-strong text-foreground">Client portal preview</span>
      <span className="min-w-0 flex-1 type-small text-muted-foreground">
        You are seeing what {companyName} client users see. Read-only: Answer now is hidden; answer from the Inbox.
      </span>
      <Link
        href={exitHref}
        className="inline-flex h-8 items-center gap-2 rounded-lg px-3 type-body text-foreground hover:bg-accent focus-visible:shadow-focus-ring outline-none"
      >
        <Icon name="x" size={16} />
        Exit preview
      </Link>
    </div>
  );
}
