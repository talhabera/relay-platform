import * as React from "react";

import { Icon, ProgressBar, StatusChip } from "@/components/v2/primitives";
import { GoalStrip, WorkflowStageNode } from "@/components/v2/work";
import { cn } from "@/lib/utils";

/** Week canon used across Figma (Goal strip description): 21–27 Sep 2026, 6 / 10, 82, €41. */
const GOAL = { weekLabel: "21–27 Sep", delivered: 6, target: 10, quality: 82, costPerLead: "€41" } as const;

const stageClass = "w-full md:w-auto md:min-w-0 md:flex-1";
/** `figure` layout (09 blog-post `figure/lead engine`): stages wrap two per row at md. */
const figureStageClass = "w-full md:w-auto md:min-w-0 md:basis-[calc(50%-0.5rem)] md:grow";

function Edge({ active = false, hiddenAtMd = false }: { active?: boolean; hiddenAtMd?: boolean }) {
  return (
    <span
      aria-hidden
      data-slot="preview-edge"
      className={cn(
        "h-4 w-0.5 shrink-0 self-center md:h-0.5 md:w-6",
        active ? "bg-primary opacity-70" : "bg-border-strong",
        hiddenAtMd && "md:hidden",
      )}
    />
  );
}

/**
 * Figma 09 `product preview` (`414:59502`): Lead engine header, Goal strip (desktop) or a
 * compact goal line (390), and the four-stage canvas, horizontal on desktop, vertical at 390.
 * Illustration only: hidden from assistive tech and not interactive. `layout="figure"` is the
 * 720-wide blog figure: compact goal line at every width, stages two per row from md.
 */
export function ProductPreview({ className, layout = "hero" }: { className?: string; layout?: "hero" | "figure" }) {
  const figure = layout === "figure";
  const stage = figure ? figureStageClass : stageClass;
  return (
    <div
      data-slot="product-preview"
      aria-hidden
      inert
      className={cn(
        "flex w-full flex-col items-start gap-5 overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-elevation-3",
        className,
      )}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Icon name="workflow" size={20} className="shrink-0 text-primary" />
          <span className="type-h3 whitespace-nowrap text-foreground">Lead engine</span>
          <span className={cn("hidden truncate type-small text-muted-foreground", !figure && "md:inline")}>
            Acme GmbH · this week, 21–27 Sep 2026
          </span>
        </div>
        <StatusChip tone="live" />
      </div>

      {figure ? null : <GoalStrip {...GOAL} className="hidden md:flex" />}
      <div data-slot="preview-goal-mobile" className={cn("flex w-full flex-col gap-2", !figure && "md:hidden")}>
        <span className="type-small text-foreground">
          {GOAL.delivered} of {GOAL.target} qualified leads delivered · {GOAL.weekLabel}
        </span>
        <ProgressBar value={GOAL.delivered} max={GOAL.target} />
        <span className="type-caption text-muted-foreground">
          Lead quality {GOAL.quality} · {GOAL.costPerLead} per qualified lead
        </span>
      </div>

      <div
        data-slot="preview-canvas"
        className={cn(
          "flex w-full flex-col items-stretch gap-2 rounded-xl bg-canvas p-6 md:flex-row md:items-center",
          figure && "md:flex-wrap md:gap-4",
        )}
      >
        <WorkflowStageNode
          className={stage}
          stage="Gather"
          agent={{ name: "Lead Gatherer", version: "v1", status: "live" }}
          count="146 gathered"
        />
        <Edge hiddenAtMd={figure} />
        <WorkflowStageNode
          className={stage}
          stage="Qualify"
          agent={{ name: "Lead Qualifier", version: "v1", status: "live" }}
          count="44 qualified"
        />
        <Edge hiddenAtMd={figure} />
        <WorkflowStageNode
          className={stage}
          stage="Outreach"
          state="needs_you"
          pending={1}
          agent={{ name: "Mail Marketer", version: "v1", status: "live" }}
          count="31 contacted · 9 replied"
        />
        <Edge active hiddenAtMd={figure} />
        <OutcomeStage className={stage} stage="Delivered to client" count="6 delivered" />
      </div>
    </div>
  );
}

/**
 * Outcome stage (`Stage/Delivered to client`): the stage node without an agent row.
 * `WorkflowStageNode` renders "No agent" for a null agent, which the landing frame does not show.
 */
function OutcomeStage({ className, stage, count }: { className: string; stage: string; count: string }) {
  return (
    <div
      data-slot="workflow-stage-node"
      data-state="default"
      className={cn(
        "relative flex flex-col items-start gap-2 rounded-xl border border-border bg-card px-4 pt-3 pb-4 shadow-elevation-1",
        className,
      )}
    >
      <span className="truncate type-body-strong text-foreground">{stage}</span>
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
        <span className="type-small text-muted-foreground">{count}</span>
      </div>
      <span aria-hidden className="absolute top-1/2 -left-[5px] size-2 -translate-y-1/2 rounded-full bg-border-strong" />
      <span aria-hidden className="absolute top-1/2 -right-[5px] size-2 -translate-y-1/2 rounded-full bg-border-strong" />
    </div>
  );
}
