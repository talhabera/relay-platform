import * as React from "react";

import { cn } from "@/lib/utils";

import { Icon, type IconName } from "../primitives/icon";
import { ProgressBar } from "../primitives/progress-bar";

type GoalStripProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Week range, e.g. "21–27 Sep". */
  weekLabel: string;
  /** Qualified leads delivered this week. */
  delivered: number;
  /** Weekly target. */
  target: number;
  /** Average fit score of qualified leads, 0-100; null when unknown. */
  quality: number | null;
  /** Pre-formatted currency, e.g. "€41"; null when unknown. */
  costPerLead: string | null;
};

function GoalCard({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <div
      data-slot="goal-strip-card"
      className="flex min-w-0 flex-1 items-start gap-4 rounded-xl border border-border bg-card p-5 shadow-elevation-1"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon name={icon} size={20} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    </div>
  );
}

function Value({ value, suffix }: { value: React.ReactNode; suffix?: string }) {
  return (
    <div className="flex items-baseline gap-1 whitespace-nowrap">
      <span className="type-metric text-foreground">{value}</span>
      {suffix ? <span className="type-h3 text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

/**
 * Figma `Goal strip` (02 `375:24042`): qualified leads delivered vs weekly target (Progress bar),
 * lead quality score, cost per qualified lead. Three equal cards; stacks below md.
 */
function GoalStrip({ className, weekLabel, delivered, target, quality, costPerLead, ...props }: GoalStripProps) {
  const pct = target > 0 ? Math.round((Math.min(Math.max(delivered, 0), target) / target) * 100) : 0;
  return (
    <div
      data-slot="goal-strip"
      className={cn("flex w-full flex-col gap-4 md:flex-row md:items-stretch", className)}
      {...props}
    >
      <GoalCard icon="users">
        <span className="type-small text-muted-foreground">Qualified leads delivered · {weekLabel}</span>
        <Value value={delivered} suffix={`/ ${target}`} />
        <div className="flex items-center gap-3">
          <ProgressBar value={delivered} max={target} aria-label="Weekly target progress" className="flex-1" />
          <span className="shrink-0 type-caption text-muted-foreground">{pct}%</span>
        </div>
      </GoalCard>
      <GoalCard icon="gauge">
        <span className="type-small text-muted-foreground">Lead quality score</span>
        <Value value={quality ?? "—"} suffix={quality == null ? undefined : "/ 100"} />
        <span className="type-caption text-muted-foreground">Average fit score of qualified leads</span>
      </GoalCard>
      <GoalCard icon="target">
        <span className="type-small text-muted-foreground">Cost per qualified lead</span>
        <Value value={costPerLead ?? "—"} />
        <span className="type-caption text-muted-foreground">Agent runs and connector credits</span>
      </GoalCard>
    </div>
  );
}

export { GoalStrip };
export type { GoalStripProps };
