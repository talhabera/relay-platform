import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { AgentChip, type AgentChipProps } from "../primitives/agent-chip";
import { Icon } from "../primitives/icon";
import { IconButton } from "../primitives/icon-button";
import { StatusChip, type StatusTone } from "../primitives/status-chip";

type ScheduleResult = "success" | "error" | "pending" | "needs-you";

type ScheduleRowProps = {
  className?: string;
  density?: "default" | "compact";
  name: string;
  /** "Lead engine · Gather" (default density). */
  workflow: string;
  agent: { name: string; version?: string; status?: AgentChipProps["status"] };
  cadence: string;
  nextRun: string;
  /** Last run result; null when the job has never run. */
  lastResult: ScheduleResult | null;
  /** Overrides the last result chip label (e.g. "Checkpoint", "Question open"). */
  lastResultLabel?: string;
  resultNote?: string;
  /** Approval policy, e.g. "Nothing leaves Relay". */
  approval: string;
  /** Opens the last run session (default density, Figma `last run link`). */
  lastRunHref?: string;
  lastRunLabel?: string;
  /** Compact: second line, e.g. "Daily · 06:00 · Lead engine". */
  meta?: string;
  /** Compact: the whole row links here. */
  href?: string;
  /** Default: overflow menu trigger handler. */
  onMore?: () => void;
  /** Default: the schedule name links here (e.g. opens the editor). */
  nameHref?: string;
  /** Default: replaces the overflow Icon button (e.g. a dropdown menu with its own trigger). */
  actions?: React.ReactNode;
};

const resultTone: Record<ScheduleResult, StatusTone> = {
  success: "success",
  error: "error",
  pending: "pending",
  "needs-you": "needs-you",
};
const resultLabel: Record<ScheduleResult, string> = {
  success: "Success",
  error: "Error",
  pending: "Running",
  "needs-you": "Needs you",
};

function ResultChip({ result, label }: { result: ScheduleResult | null; label?: string }) {
  return result ? (
    <StatusChip tone={resultTone[result]}>{label ?? resultLabel[result]}</StatusChip>
  ) : (
    <StatusChip tone="neutral">No runs yet</StatusChip>
  );
}

/**
 * Figma `Schedule row` (02 `444:37734`): one scheduled job. density=default is the table row
 * (schedule + workflow, agent, cadence, next run, last result, approvals, overflow);
 * density=compact is the 400-wide list item for the operator Inspector Schedules tab.
 */
function ScheduleRow({
  className,
  density = "default",
  name,
  workflow,
  agent,
  cadence,
  nextRun,
  lastResult,
  lastResultLabel,
  resultNote,
  approval,
  lastRunHref,
  lastRunLabel = "Open last run",
  meta,
  href,
  onMore,
  nameHref,
  actions,
}: ScheduleRowProps) {
  if (density === "compact") {
    const cls = cn(
      "flex h-16 w-full items-center gap-3 rounded-lg border border-border bg-card p-3 outline-none",
      href && "transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
      className,
    );
    const body = (
      <>
        <span className="flex shrink-0 items-center justify-center rounded-md bg-primary-soft p-2 text-primary">
          <Icon name="calendar-clock" size={16} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col whitespace-nowrap">
          <span className="truncate type-body-strong text-foreground">{name}</span>
          <span className="truncate type-caption text-muted-foreground">{meta ?? `${cadence} · ${workflow}`}</span>
        </span>
        <ResultChip result={lastResult} label={lastResultLabel} />
        <Icon name="chevron-right" size={16} className="text-muted-foreground" />
      </>
    );
    return href ? (
      <Link href={href} data-slot="schedule-row" data-density="compact" className={cls}>
        {body}
      </Link>
    ) : (
      <div data-slot="schedule-row" data-density="compact" className={cls}>
        {body}
      </div>
    );
  }

  return (
    <div
      data-slot="schedule-row"
      data-density="default"
      className={cn("flex min-h-16 w-full items-center gap-4 border-b border-border px-4 py-3", className)}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {nameHref ? (
          <Link
            href={nameHref}
            className="w-fit max-w-full truncate rounded-sm type-body-strong text-foreground outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {name}
          </Link>
        ) : (
          <span className="type-body-strong text-foreground">{name}</span>
        )}
        <span className="truncate type-caption text-muted-foreground">{workflow}</span>
      </div>
      <div className="flex w-61 shrink-0 items-start">
        <AgentChip kind="operator" name={agent.name} version={agent.version} status={agent.status ?? "none"} />
      </div>
      <span className="w-37.5 shrink-0 type-small text-foreground">{cadence}</span>
      <span className="w-37.5 shrink-0 type-small text-foreground">{nextRun}</span>
      <div className="flex w-62.5 shrink-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <ResultChip result={lastResult} label={lastResultLabel} />
          {lastRunHref ? (
            <Link
              href={lastRunHref}
              className="rounded-sm type-small whitespace-nowrap text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {lastRunLabel}
            </Link>
          ) : null}
        </div>
        {resultNote ? <span className="type-caption text-muted-foreground">{resultNote}</span> : null}
      </div>
      <span className="w-37.5 shrink-0 type-small text-foreground">{approval}</span>
      {actions ?? <IconButton icon="ellipsis" label={`More actions for ${name}`} size="sm" onClick={onMore} />}
    </div>
  );
}

export { ScheduleRow };
export type { ScheduleResult, ScheduleRowProps };
