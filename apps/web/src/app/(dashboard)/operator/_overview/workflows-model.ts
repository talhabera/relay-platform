import type { CanvasSurfaceEdge } from "@/components/v2/canvas";
import type { IconName } from "@/components/v2/primitives";
import type { StageState, WorkflowStageView, WorkflowView } from "@/lib/fixtures/interfaces";
import type { MetricKey } from "@/lib/workflows/metrics";

import type { OperatorAgentOption } from "./overview-model";

// Pure view model for the Operator Overview workflows canvas (Figma 05
// `operator-home/default`, 411:30197): one lane per workflow, one column per
// stage, edges between consecutive stages of `sequence` workflows (workflow spec
// decision 6) and a teal edge from the inbound node to the inbound stage.

export type LaneStageNode = {
  type: "stage";
  id: string;
  name: string;
  /** Null when the stage's agent was deleted ("No agent"). */
  agent: { name: string; version?: string; status: "live" | "draft" | "none" } | null;
  count: string;
  state: StageState;
  pending: number;
};

/** A stage with no agent that a workflow counts toward ("Delivered to client"). */
export type LaneOutcomeNode = { type: "outcome"; id: string; name: string; count: string };

export type LaneInboundNode = {
  type: "inbound";
  id: string;
  /** "2 customer agents". */
  agents: string;
  /** "9 leads from 22 conversations". */
  line: string;
};

export type LaneNode = LaneStageNode | LaneOutcomeNode | LaneInboundNode;

export type LaneColumn = { id: string; nodes: LaneNode[] };

export type WorkflowLane = {
  id: string;
  name: string;
  icon: IconName;
  /** "Gather → Qualify → Outreach → Delivered to client" or "Content calendar · Review management". */
  path: string;
  /** Takes the full row (Lead engine); narrow lanes share a row, sized by their columns. */
  wide: boolean;
  columns: LaneColumn[];
  edges: CanvasSurfaceEdge[];
};

export const stageNodeId = (stageId: string) => `stage:${stageId}`;
export const inboundNodeId = (workflowId: string) => `inbound:${workflowId}`;

const OUTCOME_KEYS: ReadonlySet<MetricKey> = new Set(["records.delivered", "leads.qualified_delivered"]);

const COUNT: Partial<Record<MetricKey, (v: number) => string>> = {
  "records.gathered": (v) => `${v} gathered`,
  "records.qualified": (v) => `${v} qualified`,
  "records.contacted_replied": (v) => `${v} contacted`,
  "records.delivered": (v) => `${v} delivered`,
  "leads.qualified_delivered": (v) => `${v} delivered`,
  "posts.scheduled_review": (v) => `${v} posts`,
  "reviews.new_negative": (v) => `${v} new`,
};

const NO_DATA = "No data yet";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Stage metric line, e.g. "146 gathered"; "No data yet" until the metric has a source. */
export function stageCount(stage: Pick<WorkflowStageView, "metricKey" | "metricValue">): string {
  if (stage.metricValue == null) return NO_DATA;
  return COUNT[stage.metricKey]?.(stage.metricValue) ?? String(stage.metricValue);
}

function laneIcon(w: WorkflowView): IconName {
  const key = [...w.stages].sort((a, b) => a.order - b.order)[0]?.metricKey;
  if (key === "posts.scheduled_review" || key === "reviews.new_negative") return "megaphone";
  if (key === "report.next_run") return "chart-no-axes-column";
  return "workflow";
}

function isOutcome(stage: WorkflowStageView): boolean {
  return stage.agent === null && OUTCOME_KEYS.has(stage.metricKey);
}

function outcomeCount(stage: WorkflowStageView, w: WorkflowView): string {
  if (w.target && w.target.metricKey === stage.metricKey) {
    return `${w.target.value} of ${w.target.weeklyTarget} this week`;
  }
  return stageCount(stage);
}

function toNode(
  stage: WorkflowStageView,
  w: WorkflowView,
  agents: ReadonlyMap<string, OperatorAgentOption>,
): LaneStageNode | LaneOutcomeNode {
  const id = stageNodeId(stage.id);
  if (isOutcome(stage)) return { type: "outcome", id, name: stage.name, count: outcomeCount(stage, w) };
  const version = stage.agent ? agents.get(stage.agent.id)?.version : null;
  return {
    type: "stage",
    id,
    name: stage.name,
    agent: stage.agent
      ? { name: stage.agent.name, version: version?.name, status: version?.status ?? "none" }
      : null,
    count: stageCount(stage),
    // A stage with items waiting reads as needs-you even if the reader left it default.
    state: stage.pending > 0 && stage.state === "default" ? "needs_you" : stage.state,
    pending: stage.pending,
  };
}

export function buildWorkflowLanes(
  workflows: readonly WorkflowView[],
  agents: readonly OperatorAgentOption[],
): WorkflowLane[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  return [...workflows]
    .sort((a, b) => a.position - b.position)
    .filter((w) => w.stages.length > 0)
    .map((w): WorkflowLane => {
      const stages = [...w.stages].sort((a, b) => a.order - b.order);
      const columns: LaneColumn[] = stages.map((s) => ({ id: s.id, nodes: [toNode(s, w, byId)] }));
      const known = new Set(stages.map((s) => s.id));

      const edges: CanvasSurfaceEdge[] =
        w.flow === "sequence"
          ? w.edges
              .filter((e) => known.has(e.fromStageId) && known.has(e.toStageId))
              .map((e) => ({ from: stageNodeId(e.fromStageId), to: stageNodeId(e.toStageId) }))
          : [];

      // Inbound node sits under the column before the inbound stage, feeding it from the left.
      const inboundAt = w.inbound ? stages.findIndex((s) => s.id === w.inbound!.stageId) : -1;
      if (w.inbound && inboundAt >= 0) {
        const node: LaneInboundNode = {
          type: "inbound",
          id: inboundNodeId(w.id),
          agents: plural(w.inbound.customerAgents.length, "customer agent", "customer agents"),
          line: `${plural(w.inbound.leads, "lead", "leads")} from ${plural(w.inbound.conversations, "conversation", "conversations")}`,
        };
        if (inboundAt > 0) columns[inboundAt - 1].nodes.push(node);
        else columns.unshift({ id: "inbound", nodes: [node] });
        edges.push({ from: node.id, to: stageNodeId(w.inbound.stageId), tone: "active" });
      }

      return {
        id: w.id,
        name: w.name,
        icon: laneIcon(w),
        path: stages.map((s) => s.name).join(w.flow === "sequence" ? " → " : " · "),
        wide: columns.length > 2,
        columns,
        edges,
      };
    });
}
