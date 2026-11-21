import * as React from "react";

import type { StageState } from "@/lib/fixtures/interfaces";
import { cn } from "@/lib/utils";

import { AgentChip, type AgentChipProps } from "../primitives/agent-chip";
import { CountBadge } from "../primitives/count-badge";

type WorkflowStageNodeProps = Omit<React.ComponentProps<"div">, "children"> & {
  stage: string;
  /** Null for an outcome stage or a deleted agent. */
  agent: { name: string; version?: string; status?: AgentChipProps["status"] } | null;
  /** Metric line, e.g. "44 qualified". */
  count: string;
  state?: StageState;
  /** Needs you items for the stage's agent; badge shows in state needs_you. */
  pending?: number;
};

const cardClass: Record<StageState, string> = {
  default: "border-border bg-card shadow-elevation-1",
  active: "border-primary bg-card shadow-glow-primary",
  needs_you: "border-status-needs-you-foreground bg-card shadow-elevation-1",
  idle: "border-dashed border-border-strong shadow-elevation-1",
};

const dotClass: Record<StageState, string> = {
  default: "bg-success",
  active: "bg-primary",
  needs_you: "bg-warning",
  idle: "bg-muted-foreground",
};

const portClass = "absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-border-strong";

/**
 * Figma `Workflow stage node` (02 `375:25134`): stage card on the Operator workflows canvas,
 * 288 wide. state default | active (teal border + glow, one per view) | needs_you (amber
 * border + Count badge) | idle (dashed). Ports anchor canvas edges.
 */
function WorkflowStageNode({
  className,
  stage,
  agent,
  count,
  state = "default",
  pending = 0,
  ...props
}: WorkflowStageNodeProps) {
  return (
    <div
      data-slot="workflow-stage-node"
      data-state={state}
      className={cn(
        "relative flex w-72 max-w-full flex-col items-start gap-2 rounded-xl border px-4 pt-3 pb-4",
        cardClass[state],
        className,
      )}
      {...props}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span
          data-slot="workflow-stage-name"
          className={cn("truncate type-body-strong", state === "idle" ? "text-muted-foreground" : "text-foreground")}
        >
          {stage}
        </span>
        {state === "needs_you" && pending > 0 ? (
          <CountBadge tone="warning" count={pending} aria-label={`${pending} need you`} />
        ) : null}
      </div>
      {agent ? (
        <AgentChip kind="operator" name={agent.name} version={agent.version} status={agent.status ?? "none"} />
      ) : (
        <span className="type-small text-muted-foreground">No agent</span>
      )}
      <div className="flex items-center gap-2">
        <span data-slot="workflow-stage-dot" aria-hidden className={cn("size-2 shrink-0 rounded-full", dotClass[state])} />
        <span className="type-small text-muted-foreground">{count}</span>
      </div>
      <span data-slot="workflow-stage-port-in" aria-hidden className={cn(portClass, "-left-[5px]")} />
      <span data-slot="workflow-stage-port-out" aria-hidden className={cn(portClass, "-right-[5px]")} />
    </div>
  );
}

export { WorkflowStageNode };
export type { WorkflowStageNodeProps };
