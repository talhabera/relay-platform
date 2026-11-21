import type * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/v2/primitives";
import { GoalStrip, NeedsYouList } from "@/components/v2/work";
import type { CompanyKpis } from "@/lib/metrics";
import type { NeedsYouList as NeedsYouData } from "@/lib/operator/needs-you";
import { toNeedsYouRow } from "@/lib/operator/needs-you-view";

import { SessionsTable } from "../_sessions/sessions-view";
import type { SessionListRow } from "../_sessions/sessions-list";
import { formatCostPerLead, recentSessionsSummary, weekRangeLabel } from "./overview-model";

type OperatorOverviewProps = {
  companyName: string;
  timeZone: string;
  now: Date;
  needsYou: NeedsYouData;
  kpis: CompanyKpis | null;
  leadTarget: number | null;
  recent: SessionListRow[];
  totalSessions: number;
  /** New-session dialog (client). */
  newSession: React.ReactNode;
  /** Workflows canvas (S41). */
  canvas?: React.ReactNode;
};

const cardClass = "rounded-2xl border border-border bg-card shadow-elevation-1";

/**
 * Figma 05 `operator-home/default` (411:30197): Needs you column (360), Workflows card
 * (title + week, New session, KPI strip, canvas), Recent sessions card under both.
 */
export function OperatorOverview({
  companyName,
  timeZone,
  now,
  needsYou,
  kpis,
  leadTarget,
  recent,
  totalSessions,
  newSession,
  canvas,
}: OperatorOverviewProps) {
  const week = kpis ? weekRangeLabel(kpis.range, timeZone) : null;
  const rows = needsYou.items.map((item) => toNeedsYouRow(item, now));

  return (
    <div data-slot="operator-overview" className="flex flex-col gap-6 pt-2">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <NeedsYouList
          items={rows}
          total={needsYou.total}
          className="lg:max-h-[828px] lg:w-[360px] lg:shrink-0 lg:overflow-y-auto"
        />

        <section
          data-slot="operator-workflows"
          aria-labelledby="operator-workflows-title"
          className={`${cardClass} flex min-w-0 flex-1 flex-col gap-4 p-5`}
        >
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h1 id="operator-workflows-title" className="type-h2 text-foreground">
                Workflows
              </h1>
              <p className="truncate type-small text-muted-foreground">
                {week ? `${companyName} · Week ${week}` : companyName}
              </p>
            </div>
            {newSession}
          </div>

          {kpis && leadTarget != null ? (
            <GoalStrip
              weekLabel="this week"
              delivered={kpis.qualifiedDelivered}
              target={leadTarget}
              quality={kpis.qualityScore}
              costPerLead={formatCostPerLead(kpis.costPerQualifiedLead?.estimatedUsdPerLead)}
            />
          ) : null}

          {canvas}
        </section>
      </div>

      <section
        data-slot="operator-recent-sessions"
        aria-labelledby="operator-recent-title"
        className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-elevation-1"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="operator-recent-title" className="type-h3 text-foreground">
              Recent sessions
            </h2>
            <p className="type-small text-muted-foreground">
              {recentSessionsSummary(recent.length, totalSessions)}
            </p>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/operator?tab=sessions">View all sessions</Link>
          </Button>
        </div>
        {recent.length > 0 ? (
          <SessionsTable rows={recent} timeZone={timeZone} now={now} />
        ) : (
          <div
            data-slot="recent-sessions-empty"
            className="flex flex-col items-center gap-2 rounded-xl border border-border p-6 text-center"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-foreground">
              <Icon name="message-square" size={18} />
            </span>
            <p className="type-body-strong text-foreground">No sessions yet</p>
            <p className="type-small text-muted-foreground">Start one with New session.</p>
          </div>
        )}
      </section>
    </div>
  );
}
