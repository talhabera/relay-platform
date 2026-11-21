import type { CanvasSource, CanvasSurfaceEdge } from "@/components/v2/canvas";
import type { IconName, StatusTone } from "@/components/v2/primitives";
import type { WorkflowView } from "@/lib/fixtures/interfaces";
import type { MetricKey } from "@/lib/workflows/metrics";

// Pure view model for the Home agent map (Figma 04 `home/default`, `413:52668`).
// Read-only: sources -> customer agents (channels), customer agents -> the inbound
// stage's agent (teal), operator -> operator from the stage order of `sequence`
// workflows (workflow spec decisions 4, 6, 8). No lanes; those are the operator overview.

export type AgentMapAgent = {
  id: string;
  name: string;
  kind: "customer" | "operator";
  model: "haiku" | "sonnet" | "opus";
  isActive: boolean;
  /** Name of the live version ("v1"); null when the agent has no live version. */
  liveVersion: string | null;
};

export type AgentMapChannel = {
  agentId: string;
  type: "widget" | "whatsapp" | "instagram" | "messenger" | "telegram";
  active: boolean;
};

export type AgentMapInput = {
  agents: readonly AgentMapAgent[];
  channels: readonly AgentMapChannel[];
  workflows: readonly WorkflowView[];
  hasKnowledgeBase: boolean;
  hasHandoff: boolean;
};

type Status = { tone: StatusTone; label: string };

export type AgentMapSource = { id: string; source: CanvasSource };
export type AgentMapCustomer = { id: string; name: string; status: Status; paused: boolean };
export type AgentMapOperator = {
  id: string;
  name: string;
  eyebrow: string;
  icon: IconName;
  status: Status;
  paused: boolean;
};

export type AgentMapModel = {
  /** "7 agents · 4 sources · 1 workflow": the real workflow count (decision 8), not the design's 4. */
  meta: string;
  live: boolean;
  sources: AgentMapSource[];
  customers: AgentMapCustomer[];
  operators: AgentMapOperator[];
  /** Integration chips under the customer agents: "Knowledge base", "Human handoff". */
  integrations: string[];
  edges: CanvasSurfaceEdge[];
  /** Footer line explaining the teal edges; null without inbound edges. */
  legend: string | null;
};

export const sourceNodeId = (source: CanvasSource) => `source:${source}`;
export const agentNodeId = (agentId: string) => `agent:${agentId}`;

const SOURCE_ORDER: readonly CanvasSource[] = ["website", "whatsapp", "instagram", "messenger", "telegram"];

const CHANNEL_SOURCE: Record<AgentMapChannel["type"], CanvasSource> = {
  widget: "website",
  whatsapp: "whatsapp",
  instagram: "instagram",
  messenger: "messenger",
  telegram: "telegram",
};

const MODEL_LABEL: Record<AgentMapAgent["model"], string> = {
  haiku: "Claude Haiku",
  sonnet: "Claude Sonnet",
  opus: "Claude Opus",
};

/** Icon by the first stage an agent runs (Figma: Lead Gatherer user, Qualifier list-checks, ...). */
const STAGE_ICON: Partial<Record<MetricKey, IconName>> = {
  "records.gathered": "user",
  "records.qualified": "list-checks",
  "records.contacted_replied": "mail",
  "posts.scheduled_review": "megaphone",
  "reviews.new_negative": "megaphone",
  "report.next_run": "trending-up",
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function agentMapMeta(agents: number, sources: number, workflows: number): string {
  return [plural(agents, "agent", "agents"), plural(sources, "source", "sources"), plural(workflows, "workflow", "workflows")].join(
    " · ",
  );
}

function operatorStatus(agent: AgentMapAgent): Status {
  if (!agent.isActive) return { tone: "neutral", label: "Paused" };
  if (agent.liveVersion) return { tone: "live", label: `${agent.liveVersion} Live` };
  return { tone: "draft", label: "Draft" };
}

function customerStatus(agent: AgentMapAgent): Status {
  return agent.isActive ? { tone: "live", label: "Live" } : { tone: "neutral", label: "Paused" };
}

export function buildAgentMap(input: AgentMapInput): AgentMapModel | null {
  if (input.agents.length === 0) return null;
  const byId = new Map(input.agents.map((a) => [a.id, a]));
  const workflows = [...input.workflows].sort((a, b) => a.position - b.position);
  const isKind = (id: string | undefined, kind: AgentMapAgent["kind"]) => !!id && byId.get(id)?.kind === kind;

  // Operators: stage order of each workflow first, so sequence neighbours stack; the rest after.
  const operatorIds: string[] = [];
  const firstMetric = new Map<string, MetricKey>();
  for (const w of workflows) {
    for (const stage of [...w.stages].sort((a, b) => a.order - b.order)) {
      const id = stage.agent?.id;
      if (!id || !isKind(id, "operator") || firstMetric.has(id)) continue;
      firstMetric.set(id, stage.metricKey);
      operatorIds.push(id);
    }
  }
  for (const a of input.agents) if (a.kind === "operator" && !operatorIds.includes(a.id)) operatorIds.push(a.id);

  const operators = operatorIds.map((id): AgentMapOperator => {
    const agent = byId.get(id)!;
    const metric = firstMetric.get(id);
    return {
      id: agentNodeId(id),
      name: agent.name,
      eyebrow: MODEL_LABEL[agent.model],
      icon: (metric && STAGE_ICON[metric]) || "bot",
      status: operatorStatus(agent),
      paused: !agent.isActive,
    };
  });

  const customerAgents = input.agents.filter((a) => a.kind === "customer");
  const customers = customerAgents.map(
    (a): AgentMapCustomer => ({ id: agentNodeId(a.id), name: a.name, status: customerStatus(a), paused: !a.isActive }),
  );

  const edges: CanvasSurfaceEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (edge: CanvasSurfaceEdge) => {
    const key = `${edge.from}->${edge.to}`;
    if (edge.from === edge.to || seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };

  // Sources: active channels of customer agents, one node per source type.
  const sourceSet = new Set<CanvasSource>();
  for (const ch of input.channels) {
    if (!ch.active || !isKind(ch.agentId, "customer")) continue;
    const source = CHANNEL_SOURCE[ch.type];
    sourceSet.add(source);
    addEdge({ from: sourceNodeId(source), to: agentNodeId(ch.agentId) });
  }
  const sources = SOURCE_ORDER.filter((s) => sourceSet.has(s)).map((source) => ({ id: sourceNodeId(source), source }));

  // Teal: customer agents feeding the inbound stage's agent.
  let legend: string | null = null;
  for (const w of workflows) {
    if (!w.inbound) continue;
    const target = w.stages.find((s) => s.id === w.inbound?.stageId)?.agent;
    if (!target || !isKind(target.id, "operator")) continue;
    let linked = false;
    for (const c of w.inbound.customerAgents) {
      if (!isKind(c.id, "customer")) continue;
      addEdge({ from: agentNodeId(c.id), to: agentNodeId(target.id), tone: "active" });
      linked = true;
    }
    if (linked && legend === null) {
      legend = `Teal lines: inbound leads from customer agents to ${target.name} · ${w.inbound.leads} this week`;
    }
  }

  // Agent -> agent: consecutive stages of sequence workflows (WorkflowView.edges is empty for parallel).
  for (const w of workflows) {
    const stageAgent = new Map(w.stages.map((s) => [s.id, s.agent?.id]));
    for (const e of w.edges) {
      const from = stageAgent.get(e.fromStageId);
      const to = stageAgent.get(e.toStageId);
      if (!from || !to || !isKind(from, "operator") || !isKind(to, "operator")) continue;
      addEdge({ from: agentNodeId(from), to: agentNodeId(to), route: "loop" });
    }
  }

  const integrations = [
    ...(input.hasKnowledgeBase ? ["Knowledge base"] : []),
    ...(input.hasHandoff ? ["Human handoff"] : []),
  ];

  return {
    meta: agentMapMeta(input.agents.length, sources.length, input.workflows.length),
    live: input.agents.some((a) => a.isActive),
    sources,
    customers,
    operators,
    integrations,
    edges,
    legend,
  };
}
