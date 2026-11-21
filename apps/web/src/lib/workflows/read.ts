import { db } from "@/db";
import { agents, chats, cronJobs, cronRuns, workflows } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type {
  AgentRef,
  InboundSummary,
  IntakeField,
  StageState,
  TargetProgress,
  WorkflowEdge,
  WorkflowFlow,
  WorkflowsReader,
  WorkflowStageView,
  WorkflowView,
} from "@/lib/fixtures/interfaces";
import {
  loadFailedScheduleRuns,
  loadOpenAgentQuestions,
  loadOpenCheckpoints,
} from "@/lib/operator/needs-you";
import {
  INBOUND_CONVERSATIONS_METRIC,
  INBOUND_LEADS_METRIC,
  isMetricKey,
  nullMetricSource,
  type MetricKey,
  type MetricSource,
} from "./metrics";

// Read interface for workflows (workflow spec, "Minimum schema (S11)").
// Home, the Operator overview, the agent map and the /agents "USED IN" chip
// all consume `WorkflowView` through this one reader; the fixtures layer
// implements the same `WorkflowsReader`.

export type WorkflowRow = {
  id: string;
  companyId: string;
  packageSlug: string;
  name: string;
  flow: WorkflowFlow;
  position: number;
  weeklyTarget: number | null;
  targetMetricKey: string | null;
  inboundStageId: string | null;
  intake: IntakeField[];
  stages: {
    id: string;
    order: number;
    name: string;
    agentId: string | null;
    metricKey: string;
    agent: AgentRef | null;
  }[];
};

export type WorkflowViewInputs = {
  rows: WorkflowRow[];
  metrics: Partial<Record<MetricKey, number>>;
  /** Needs you items per agent (decision 9). */
  pendingByAgent: ReadonlyMap<string, number>;
  /** Agents with a running session or Schedule run. */
  activeAgentIds: ReadonlySet<string>;
  /** Customer agents feeding the inbound stage. */
  customerAgents: AgentRef[];
};

/** Edges run between consecutive stages of a `sequence` workflow (decision 6). */
export function workflowEdges(
  flow: WorkflowFlow,
  stages: readonly { id: string; order: number }[],
): WorkflowEdge[] {
  if (flow !== "sequence") return [];
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  return ordered.slice(1).map((s, i) => ({
    fromStageId: ordered[i].id,
    toStageId: s.id,
  }));
}

/** Stage state: Needs you items win, then a running agent, else default. */
export function stageState(args: {
  agentId: string | null;
  pending: number;
  active: boolean;
}): StageState {
  if (args.pending > 0) return "needs_you";
  if (args.agentId && args.active) return "active";
  return "default";
}

/** A target metric that counts leads makes a "lead workflow" (needs-you-ordering spec 1). */
export function isLeadMetricKey(key: string | null): boolean {
  return (
    isMetricKey(key) && (key.startsWith("leads.") || key.startsWith("records."))
  );
}

/** Metric keys a set of workflows needs values for. */
export function metricKeysFor(rows: readonly WorkflowRow[]): MetricKey[] {
  const keys = new Set<MetricKey>();
  for (const w of rows) {
    for (const s of w.stages) if (isMetricKey(s.metricKey)) keys.add(s.metricKey);
    if (isMetricKey(w.targetMetricKey)) keys.add(w.targetMetricKey);
    if (w.inboundStageId) {
      keys.add(INBOUND_LEADS_METRIC);
      keys.add(INBOUND_CONVERSATIONS_METRIC);
    }
  }
  return [...keys];
}

export function buildWorkflowViews(input: WorkflowViewInputs): WorkflowView[] {
  const { metrics } = input;
  return [...input.rows]
    .sort((a, b) => a.position - b.position)
    .map((w): WorkflowView => {
      const stages = [...w.stages]
        .sort((a, b) => a.order - b.order)
        .map((s): WorkflowStageView => {
          const agent = s.agentId ? s.agent : null;
          const pending = agent ? (input.pendingByAgent.get(agent.id) ?? 0) : 0;
          const known = isMetricKey(s.metricKey);
          return {
            id: s.id,
            order: s.order,
            name: s.name,
            agent,
            // Writes go through the catalog; an unknown stored key still
            // renders its stage, with no value.
            metricKey: s.metricKey as MetricKey,
            metricValue: known ? (metrics[s.metricKey as MetricKey] ?? null) : null,
            pending,
            state: stageState({
              agentId: agent?.id ?? null,
              pending,
              active: agent ? input.activeAgentIds.has(agent.id) : false,
            }),
          };
        });

      const inbound: InboundSummary | null =
        w.inboundStageId && stages.some((s) => s.id === w.inboundStageId)
          ? {
              stageId: w.inboundStageId,
              leads: metrics[INBOUND_LEADS_METRIC] ?? 0,
              conversations: metrics[INBOUND_CONVERSATIONS_METRIC] ?? 0,
              customerAgents: input.customerAgents,
            }
          : null;

      const target: TargetProgress | null =
        w.weeklyTarget !== null && isMetricKey(w.targetMetricKey)
          ? {
              weeklyTarget: w.weeklyTarget,
              metricKey: w.targetMetricKey,
              value: metrics[w.targetMetricKey] ?? 0,
            }
          : null;

      return {
        id: w.id,
        companyId: w.companyId,
        packageSlug: w.packageSlug,
        name: w.name,
        flow: w.flow,
        position: w.position,
        stages,
        edges: workflowEdges(w.flow, stages),
        inbound,
        target,
        intake: w.intake,
      };
    });
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function loadWorkflowRows(companyId: string): Promise<WorkflowRow[]> {
  const rows = await db.query.workflows.findMany({
    where: eq(workflows.companyId, companyId),
    orderBy: (w, { asc }) => [asc(w.position), asc(w.createdAt)],
    with: {
      stages: {
        orderBy: (s, { asc }) => [asc(s.order)],
        with: { agent: { columns: { id: true, name: true } } },
      },
    },
  });
  return rows.map((w) => ({
    id: w.id,
    companyId: w.companyId,
    packageSlug: w.packageSlug,
    name: w.name,
    flow: w.flow,
    position: w.position,
    weeklyTarget: w.weeklyTarget,
    targetMetricKey: w.targetMetricKey,
    inboundStageId: w.inboundStageId,
    intake: w.intake,
    stages: w.stages.map((s) => ({
      id: s.id,
      order: s.order,
      name: s.name,
      agentId: s.agentId,
      metricKey: s.metricKey,
      agent: s.agent ? { id: s.agent.id, name: s.agent.name } : null,
    })),
  }));
}

/** Needs you items per agent, unfiltered by viewer (stage badges are shared). */
async function loadPendingByAgent(companyId: string): Promise<Map<string, number>> {
  const [checkpointItems, runItems, questionItems] = await Promise.all([
    loadOpenCheckpoints(companyId),
    loadFailedScheduleRuns(companyId),
    loadOpenAgentQuestions(companyId),
  ]);
  const counts = new Map<string, number>();
  for (const item of [...checkpointItems, ...runItems, ...questionItems]) {
    counts.set(item.agentId, (counts.get(item.agentId) ?? 0) + 1);
  }
  return counts;
}

async function loadActiveAgentIds(agentIds: string[]): Promise<Set<string>> {
  const active = new Set<string>();
  if (agentIds.length === 0) return active;
  const [runningChats, jobs] = await Promise.all([
    db.query.chats.findMany({
      columns: { agentId: true },
      where: and(inArray(chats.agentId, agentIds), eq(chats.status, "running")),
    }),
    db.query.cronJobs.findMany({
      columns: { agentId: true },
      where: inArray(cronJobs.agentId, agentIds),
      with: {
        runs: {
          columns: { id: true },
          where: eq(cronRuns.status, "running"),
          limit: 1,
        },
      },
    }),
  ]);
  for (const c of runningChats) if (c.agentId) active.add(c.agentId);
  for (const j of jobs) if (j.runs.length > 0) active.add(j.agentId);
  return active;
}

/**
 * Customer agents feeding inbound. Until S104 adds the per-agent workflow
 * picker, every customer agent of the company feeds the inbound stage.
 */
async function loadCustomerAgents(companyId: string): Promise<AgentRef[]> {
  const rows = await db.query.agents.findMany({
    columns: { id: true, name: true },
    where: and(eq(agents.companyId, companyId), eq(agents.kind, "customer")),
  });
  return rows.map((a) => ({ id: a.id, name: a.name }));
}

export async function listWorkflows(
  companyId: string,
  opts: { metrics?: MetricSource; now?: Date } = {},
): Promise<WorkflowView[]> {
  const rows = await loadWorkflowRows(companyId);
  if (rows.length === 0) return [];
  const source = opts.metrics ?? nullMetricSource;
  const agentIds = [
    ...new Set(
      rows.flatMap((w) =>
        w.stages.map((s) => s.agentId).filter((id): id is string => id !== null),
      ),
    ),
  ];
  const needsInbound = rows.some((w) => w.inboundStageId !== null);
  const [metrics, pendingByAgent, activeAgentIds, customerAgents] =
    await Promise.all([
      source.getValues(companyId, metricKeysFor(rows), opts.now ?? new Date()),
      loadPendingByAgent(companyId),
      loadActiveAgentIds(agentIds),
      needsInbound ? loadCustomerAgents(companyId) : Promise.resolve([]),
    ]);
  return buildWorkflowViews({
    rows,
    metrics,
    pendingByAgent,
    activeAgentIds,
    customerAgents,
  });
}

/**
 * Agents running a stage of a lead workflow (a workflow whose target counts
 * leads). Real source for needs-you `loadLeadWorkflowAgentIds`.
 */
export async function listLeadWorkflowAgentIds(
  companyId: string,
): Promise<Set<string>> {
  const rows = await loadWorkflowRows(companyId);
  const ids = new Set<string>();
  for (const w of rows) {
    if (!isLeadMetricKey(w.targetMetricKey)) continue;
    for (const s of w.stages) if (s.agentId) ids.add(s.agentId);
  }
  return ids;
}

/**
 * Lead-workflow agents plus each agent's workflow name (first by position),
 * from one read. Needs you uses both: the tier and the row's workflow tag.
 */
export async function listAgentWorkflows(companyId: string): Promise<{
  leadAgentIds: Set<string>;
  workflowNameByAgent: Map<string, string>;
}> {
  const rows = await loadWorkflowRows(companyId);
  return agentWorkflowsFromRows(rows);
}

export function agentWorkflowsFromRows(rows: readonly WorkflowRow[]): {
  leadAgentIds: Set<string>;
  workflowNameByAgent: Map<string, string>;
} {
  const leadAgentIds = new Set<string>();
  const workflowNameByAgent = new Map<string, string>();
  for (const w of rows) {
    const lead = isLeadMetricKey(w.targetMetricKey);
    for (const s of w.stages) {
      if (!s.agentId) continue;
      if (lead) leadAgentIds.add(s.agentId);
      if (!workflowNameByAgent.has(s.agentId)) workflowNameByAgent.set(s.agentId, w.name);
    }
  }
  return { leadAgentIds, workflowNameByAgent };
}

export function createWorkflowsReader(
  opts: { metrics?: MetricSource; now?: () => Date } = {},
): WorkflowsReader {
  return {
    listWorkflows: (companyId) =>
      listWorkflows(companyId, {
        metrics: opts.metrics,
        now: opts.now?.(),
      }),
  };
}
