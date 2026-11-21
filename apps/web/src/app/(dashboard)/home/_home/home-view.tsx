import type * as React from "react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { CountBadge, Icon, StatusChip } from "@/components/v2/primitives";
import { GoalStrip, NeedsYouRow } from "@/components/v2/work";
import type { HomeTileKey } from "@relay/db/schema";
import type { CompanyKpis } from "@/lib/metrics";
import type { NeedsYouList as NeedsYouData } from "@/lib/operator/needs-you";
import { toNeedsYouRow } from "@/lib/operator/needs-you-view";
import { cn } from "@/lib/utils";

import { formatCostPerLead } from "../../operator/_overview/overview-model";
import {
  HOME_NEEDS_YOU_TOP,
  TODAY_STATE,
  needsYouMoreLabel,
  type LeadEngineRow,
  type SetupStep,
  type TodayRow,
} from "./home-model";
import { homeColumns } from "./tiles";

export const tileClass = "flex flex-col rounded-2xl border border-border bg-card shadow-elevation-1";

/** Tile card with the Figma header: title on the left, an optional link on the right. */
export function HomeTile({
  slot,
  title,
  titleExtra,
  link,
  className,
  children,
}: {
  slot: string;
  title: string;
  titleExtra?: React.ReactNode;
  link?: { href: string; label: string };
  className?: string;
  children: React.ReactNode;
}) {
  const id = `home-${slot}-title`;
  return (
    <section data-slot={`home-${slot}`} aria-labelledby={id} className={cn(tileClass, "gap-2 p-4", className)}>
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={id} className="truncate type-h3 text-foreground">
            {title}
          </h2>
          {titleExtra}
        </div>
        {link ? (
          <Link
            href={link.href}
            className="shrink-0 rounded-sm type-small text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {link.label}
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function EmptyCopy({ children }: { children: React.ReactNode }) {
  return <p className="type-small text-muted-foreground">{children}</p>;
}

// ---------------------------------------------------------------------------

export function NeedsYouTile({ data, now }: { data: NeedsYouData | null; now: Date }) {
  const items = data?.items ?? [];
  const top = items.slice(0, HOME_NEEDS_YOU_TOP).map((item) => toNeedsYouRow(item, now));
  const more = needsYouMoreLabel(items, HOME_NEEDS_YOU_TOP);
  const total = data?.total ?? 0;
  return (
    <HomeTile
      slot="needs-you"
      title="Needs you"
      titleExtra={total > 0 ? <CountBadge tone="warning" count={total} aria-label={`${total} open`} /> : null}
      link={total > 0 ? { href: "/needs-you", label: "View all" } : undefined}
    >
      {top.length === 0 ? (
        <EmptyCopy>Nothing needs you yet. Checkpoints and questions from your operator agents appear here.</EmptyCopy>
      ) : (
        <div className="flex flex-col">
          {top.map(({ id, ...row }) => (
            <NeedsYouRow key={id} {...row} />
          ))}
          {more ? (
            <Link
              href="/needs-you"
              data-slot="home-needs-you-more"
              className="rounded-sm px-1 pt-2 type-small text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {more}
            </Link>
          ) : null}
        </div>
      )}
    </HomeTile>
  );
}

export function TodayTile({ title, rows }: { title: string; rows: TodayRow[] }) {
  return (
    <HomeTile slot="today" title={title} link={{ href: "/operator?tab=cron", label: "Schedules" }}>
      {rows.length === 0 ? (
        <EmptyCopy>No scheduled jobs today. Schedules start once you pick a workflow.</EmptyCopy>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => {
            const s = TODAY_STATE[row.state];
            return (
              <li key={row.id} className="border-b border-border last:border-b-0">
                <Link
                  href={row.href}
                  data-state={row.state}
                  className="flex items-center gap-3 rounded-md py-2 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="w-11 shrink-0 font-mono type-small text-muted-foreground">{row.time}</span>
                  <Icon name={s.icon} size={16} className={cn("shrink-0", s.iconClass)} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate type-body-strong text-foreground">{row.name}</span>
                    <span className="truncate type-caption text-muted-foreground">{row.detail}</span>
                  </span>
                  <StatusChip tone={s.tone} className="shrink-0 uppercase">
                    {s.label}
                  </StatusChip>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </HomeTile>
  );
}

export function LeadEngineTile({ rows }: { rows: LeadEngineRow[] | null }) {
  if (!rows) {
    return (
      <HomeTile slot="lead-engine" title="Pipelines">
        <EmptyCopy>Pick the Lead engine workflow to see gathered, qualified and delivered leads here.</EmptyCopy>
      </HomeTile>
    );
  }
  return (
    <HomeTile slot="lead-engine" title="Lead engine · this week" link={{ href: "/operator", label: "Open workflow" }}>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 py-1.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Icon name={row.icon} size={16} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate type-body-strong text-foreground">{row.name}</span>
              {row.detail ? <span className="truncate type-caption text-muted-foreground">{row.detail}</span> : null}
            </span>
            <span className="shrink-0 type-h3 text-foreground tabular-nums">{row.value ?? "—"}</span>
          </li>
        ))}
      </ul>
    </HomeTile>
  );
}

export function SetupCard({ companyName, steps }: { companyName: string; steps: SetupStep[] }) {
  const done = steps.filter((s) => s.done).length;
  const current = steps.find((s) => !s.done)?.id;
  return (
    <section data-slot="home-setup" aria-labelledby="home-setup-title" className={cn(tileClass, "gap-4 p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="home-setup-title" className="type-h3 text-foreground">
            Set up {companyName}
          </h2>
          <p className="type-small text-muted-foreground">
            Relay starts bringing in leads once the company has a customer agent and at least one workflow.
          </p>
        </div>
        <div className="flex w-37.5 shrink-0 flex-col items-end gap-2">
          <span className="type-caption text-muted-foreground">
            {done} of {steps.length} done
          </span>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
        </div>
      </div>
      <ol className="flex flex-col gap-3">
        {steps.map((step, i) => {
          const active = step.id === current;
          return (
            <li
              key={step.id}
              data-state={step.done ? "done" : active ? "current" : "todo"}
              className={cn(
                "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start",
                active ? "border-primary bg-muted" : "border-border",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full type-small",
                  step.done ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
                )}
              >
                {step.done ? <Icon name="check" size={14} /> : i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h3 className="type-body-strong text-foreground">{step.title}</h3>
                <p className="type-small text-muted-foreground">{step.description}</p>
              </div>
              <Link
                href={step.action.href}
                className={cn(buttonVariants({ variant: active ? "default" : "outline" }), "shrink-0")}
              >
                {active && step.id === "customer-agent" ? <Icon name="plus" size={16} /> : null}
                {step.action.label}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------

export type HomeViewProps = {
  greeting: string;
  subtitle: string;
  /** Owner-only Edit Home entry (S106). */
  canEdit: boolean;
  /** New session button (client dialog); null when the viewer has no Operator access. */
  newSession: React.ReactNode;
  tiles: HomeTileKey[];
  kpis: CompanyKpis | null;
  leadTarget: number | null;
  needsYou: React.ReactNode;
  today: React.ReactNode;
  leadEngine: React.ReactNode;
  /** Daily brief tile (`BriefTile`); null when the tile is hidden or the company has no agents. */
  brief?: React.ReactNode;
  /** My tasks tile (`MyTasksTile`); null when the tile is hidden or the viewer lacks Operator access. */
  myTasks?: React.ReactNode;
  /** Koleva reklam tile (`AdReportTile`); null when the tile is hidden. */
  adReport?: React.ReactNode;
  /** Agent map canvas (S38); null when the tile is hidden or the company has no agents. */
  agentMap?: React.ReactNode;
  /** Empty state: set-up steps replace the main column. */
  setup?: React.ReactNode;
};

/** Figma 04 `home/default` and `home/member`: header, main column, 400 side column. */
export function HomeView(props: HomeViewProps) {
  const columns = homeColumns(props.tiles);
  const tile: Record<HomeTileKey, React.ReactNode> = {
    daily_brief: props.brief ? <div key="daily_brief">{props.brief}</div> : null,
    my_tasks: props.myTasks ? <div key="my_tasks">{props.myTasks}</div> : null,
    ad_report: props.adReport ? <div key="ad_report" className="min-w-0">{props.adReport}</div> : null,
    goal_strip:
      props.kpis && props.leadTarget != null ? (
        <GoalStrip
          key="goal_strip"
          weekLabel="this week"
          delivered={props.kpis.qualifiedDelivered}
          target={props.leadTarget}
          quality={props.kpis.qualityScore}
          costPerLead={formatCostPerLead(props.kpis.costPerQualifiedLead?.estimatedUsdPerLead)}
        />
      ) : null,
    agent_map: props.agentMap ? <div key="agent_map" data-slot="home-agent-map">{props.agentMap}</div> : null,
    needs_you: <div key="needs_you">{props.needsYou}</div>,
    today: <div key="today">{props.today}</div>,
    lead_engine: <div key="lead_engine">{props.leadEngine}</div>,
  };

  return (
    <div data-slot="home" className="flex flex-col gap-6 pt-2 pb-6 lg:flex-row lg:items-start">
      <div data-slot="home-main" className="flex min-w-0 flex-1 flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="type-h1 text-foreground">{props.greeting}</h1>
            <p className="type-small text-muted-foreground">{props.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {props.canEdit ? (
              <Link href="/home/edit" className={buttonVariants({ variant: "ghost" })}>
                <Icon name="pencil" size={16} />
                Edit Home
              </Link>
            ) : null}
            {props.newSession}
          </div>
        </div>
        {props.setup ?? columns.main.map((key) => tile[key])}
      </div>
      {columns.side.length > 0 ? (
        <aside data-slot="home-side" aria-label="Home tiles" className="flex w-full flex-col gap-4 lg:w-100 lg:shrink-0">
          {columns.side.map((key) => tile[key])}
        </aside>
      ) : null}
    </div>
  );
}
