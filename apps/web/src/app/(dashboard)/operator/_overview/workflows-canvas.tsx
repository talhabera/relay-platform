import { CanvasPort, CanvasSurface, type CanvasSurfaceColumn } from "@/components/v2/canvas";
import { Icon } from "@/components/v2/primitives";
import { WorkflowStageNode } from "@/components/v2/work";
import { cn } from "@/lib/utils";

import type { LaneInboundNode, LaneNode, LaneOutcomeNode, WorkflowLane } from "./workflows-model";

function OutcomeNode({ node }: { node: LaneOutcomeNode }) {
  return (
    <div
      data-slot="workflow-outcome-node"
      className="relative flex w-42 max-w-full flex-col gap-2 rounded-xl border border-border bg-card px-4 py-4 shadow-elevation-1"
    >
      <span className="type-body-strong text-foreground">{node.name}</span>
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
        <span className="type-small text-muted-foreground">{node.count}</span>
      </div>
      <CanvasPort side="left" className="invisible" />
    </div>
  );
}

function InboundNode({ node }: { node: LaneInboundNode }) {
  return (
    <div
      data-slot="workflow-inbound-node"
      className="relative flex w-58 max-w-full flex-col items-start gap-2 rounded-xl border border-border bg-card px-4 pt-3 pb-4 shadow-elevation-1"
    >
      <span className="type-body-strong text-foreground">Inbound from customer agents</span>
      <span className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-card p-1 pr-3">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-secondary text-foreground">
          <Icon name="message-circle" size={14} />
        </span>
        <span className="type-body-strong text-foreground">{node.agents}</span>
      </span>
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
        <span className="type-small text-muted-foreground">{node.line}</span>
      </div>
      <CanvasPort side="right" className="invisible" />
    </div>
  );
}

function laneNode(node: LaneNode) {
  if (node.type === "outcome") return <OutcomeNode node={node} />;
  if (node.type === "inbound") return <InboundNode node={node} />;
  return (
    <WorkflowStageNode
      stage={node.name}
      agent={node.agent}
      count={node.count}
      state={node.state}
      pending={node.pending}
      className="w-58"
    />
  );
}

function nodeLabel(node: LaneNode): string {
  if (node.type === "inbound") return "Inbound from customer agents";
  return node.name;
}

function laneColumns(lane: WorkflowLane): CanvasSurfaceColumn[] {
  return lane.columns.map((c) => ({
    id: c.id,
    nodes: c.nodes.map((n) => ({ id: n.id, label: nodeLabel(n), node: laneNode(n) })),
  }));
}

function Lane({ lane }: { lane: WorkflowLane }) {
  return (
    <details
      open
      data-slot="workflow-lane"
      data-workflow={lane.id}
      className={cn(
        "group/lane min-w-0 overflow-hidden rounded-xl border border-border bg-card",
        lane.wide ? "basis-full" : "flex-1",
      )}
      style={lane.wide ? undefined : { flexGrow: lane.columns.length }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <Icon name={lane.icon} size={18} className="shrink-0 text-foreground" />
        <h2 className="shrink-0 type-body-strong text-foreground">{lane.name}</h2>
        <span className="min-w-0 truncate type-caption text-muted-foreground">{lane.path}</span>
        <Icon
          name="chevron-down"
          size={16}
          className="ml-auto shrink-0 text-muted-foreground transition-transform group-open/lane:rotate-180"
        />
      </summary>
      <CanvasSurface
        embedded
        align="start"
        aria-label={`${lane.name} workflow`}
        listColumn={lane.columns[0]?.id ?? ""}
        columns={laneColumns(lane)}
        edges={lane.edges}
        contentClassName="gap-x-6 px-5 pt-1 pb-5"
        className="max-lg:px-4 max-lg:pb-4 lg:[&_[data-slot=canvas-surface-canvas]]:bg-card lg:[&_[data-slot=canvas-surface-canvas]]:bg-none"
      />
    </details>
  );
}

/**
 * Workflows canvas of the Operator Overview (Figma 05 `operator-home/default`, 411:30197):
 * one collapsible lane per workflow with stage nodes, sequence edges and the inbound node.
 * Read-only: no pan, zoom or selection. Under 1024 each lane renders the surface's list.
 */
export function WorkflowsCanvas({ lanes }: { lanes: WorkflowLane[] }) {
  if (lanes.length === 0) {
    return (
      <div
        data-slot="operator-workflows-empty"
        className="flex flex-col items-center gap-2 rounded-xl border border-border p-6 text-center"
      >
        <span className="flex size-9 items-center justify-center rounded-lg bg-secondary text-foreground">
          <Icon name="workflow" size={18} />
        </span>
        <p className="type-body-strong text-foreground">No workflows yet</p>
        <p className="type-small text-muted-foreground">Workflows come with packages.</p>
      </div>
    );
  }
  return (
    <div data-slot="operator-workflows-canvas" className="flex flex-wrap gap-4">
      {lanes.map((lane) => (
        <Lane key={lane.id} lane={lane} />
      ))}
    </div>
  );
}
