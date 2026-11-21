import type * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Icon, chipVariants } from "@/components/v2/primitives";
import { SessionRow, sessionStatusFromChat } from "@/components/v2/session";
import { initials } from "@/components/v2/shell/initials";
import { cn } from "@/lib/utils";

import {
  SESSION_STATUS_FILTERS,
  SESSION_STATUS_FILTER_LABEL,
  clearedSessionsHref,
  emptyFilteredDescription,
  formatLastActivity,
  formatSessionTime,
  hasActiveFilters,
  sessionRowHref,
  sessionStatusCounts,
  sessionsHref,
  sessionsSummary,
  type SessionListRow,
  type SessionsFilters,
} from "./sessions-list";

type SessionsViewProps = {
  companyName: string;
  timeZone: string;
  timeZoneLabel: string;
  filters: SessionsFilters;
  /** Sessions in the selected date range, before status/workflow/agent/search filters. */
  rangeRows: SessionListRow[];
  /** Rows after every filter. */
  rows: SessionListRow[];
  workflowName: string | null;
  agentName: string | null;
  /** Workflow/agent/date/search controls (client component). */
  controls?: React.ReactNode;
  /** New-session dialog trigger; falls back to a link to Overview. */
  newSession?: React.ReactNode;
  now: Date;
};

const HEAD = [
  { label: "Status", className: "w-[104px]" },
  { label: "Session", className: "min-w-0 flex-1" },
  { label: "Agent", className: "w-[252px]" },
  { label: "Started by", className: "w-[176px]" },
  { label: "Started", className: "w-[124px]" },
  { label: "Last activity", className: "w-[124px]" },
  { label: "Checkpoints", className: "w-[88px]" },
];

/** Figma 05 `sessions/{default, filtered, empty}`: the operator session history list. */
export function SessionsView({
  companyName,
  timeZone,
  timeZoneLabel,
  filters,
  rangeRows,
  rows,
  workflowName,
  agentName,
  controls,
  newSession,
  now,
}: SessionsViewProps) {
  const counts = sessionStatusCounts(rangeRows);
  const filtered = hasActiveFilters(filters);
  const summaryInput = { filters, total: rangeRows.length, workflowName, agentName, now, timeZone };

  return (
    <section
      data-slot="operator-sessions"
      className="flex w-full min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-elevation-1"
    >
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="type-h2 text-foreground">Sessions</h1>
          <p className="type-small text-muted-foreground">
            Every operator session for {companyName}, open or finished · Times in {timeZoneLabel}
          </p>
        </div>
        {newSession ?? (
          <Button asChild className="shrink-0">
            <Link href="/operator">
              <Icon name="plus" size={16} />
              New session
            </Link>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-2">
          {SESSION_STATUS_FILTERS.map((status) => {
            const selected = filters.status === status;
            return (
              <Link
                key={status}
                href={sessionsHref(filters, { status })}
                aria-current={selected ? "true" : undefined}
                data-slot="status-filter"
                data-status={status}
                className={chipVariants({ variant: selected ? "selected" : "default", size: "md" })}
              >
                {SESSION_STATUS_FILTER_LABEL[status]} {counts[status]}
              </Link>
            );
          })}
        </div>
        {controls}
      </div>

      {rows.length > 0 ? (
        <SessionsTable rows={rows} timeZone={timeZone} now={now} />
      ) : (
        <div
          data-slot="sessions-empty"
          className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-border p-6 text-center"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-foreground">
            <Icon name={filtered ? "filter" : "message-square"} size={18} />
          </span>
          <h2 className="type-body-strong text-foreground">
            {filtered ? "No sessions match these filters" : "No sessions yet"}
          </h2>
          <p className="max-w-md type-small text-muted-foreground">
            {filtered
              ? emptyFilteredDescription(summaryInput)
              : "Sessions appear here once someone starts one from Overview or a schedule runs."}
          </p>
          {filtered ? (
            <Button asChild size="sm">
              <Link href={clearedSessionsHref(filters)}>
                <Icon name="x" size={16} />
                Clear filters
              </Link>
            </Button>
          ) : null}
        </div>
      )}

      <p className="flex items-center gap-2 type-caption text-muted-foreground">
        <Icon name="info" size={16} />
        {sessionsSummary({ ...summaryInput, shown: rows.length })}
      </p>
    </section>
  );
}

/** The sessions table (head + Session rows); shared with Overview's Recent sessions. */
export function SessionsTable({
  rows,
  timeZone,
  now,
}: {
  rows: SessionListRow[];
  timeZone: string;
  now: Date;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <div role="table" aria-label="Sessions" className="min-w-[1120px]">
        <div role="row" className="flex h-10 items-center gap-3 border-b border-border px-4">
          {HEAD.map((col) => (
            <span
              key={col.label}
              role="columnheader"
              className={cn("shrink-0 truncate type-label text-muted-foreground", col.className)}
            >
              {col.label}
            </span>
          ))}
          <span className="w-4 shrink-0" aria-hidden />
        </div>
        {rows.map((row) => (
          <SessionRow
            key={row.id}
            role="row"
            href={sessionRowHref(row)}
            className="last:border-b-0"
            status={sessionStatusFromChat(row.status)}
            title={row.title}
            workflow={row.workflowLabel ?? undefined}
            agent={{
              kind: "operator",
              name: row.agentName,
              version: row.versionName ?? undefined,
              status: row.versionStatus ?? "none",
            }}
            startedBy={
              row.scheduleName
                ? { kind: "schedule", name: row.scheduleName }
                : { kind: "person", name: row.starterName ?? "Unknown", initials: initials(row.starterName) }
            }
            started={formatSessionTime(row.createdAt, timeZone)}
            lastActivity={formatLastActivity(row.lastActivityAt, now, timeZone)}
            checkpoints={row.openCheckpoints}
          />
        ))}
      </div>
    </div>
  );
}
