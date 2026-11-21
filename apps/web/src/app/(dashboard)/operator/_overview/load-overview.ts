import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { agents, agentVersions } from "@/db/schema";
import type { WorkflowView } from "@/lib/fixtures/interfaces";
import { getCompanyKpis, workflowsReader, type CompanyKpis } from "@/lib/metrics";
import { getNeedsYou, type NeedsYouList } from "@/lib/operator/needs-you";

import { loadOperatorSessions } from "../_sessions/load-sessions";
import type { SessionListRow } from "../_sessions/sessions-list";
import { buildSessionTargets, type OperatorAgentOption, type SessionTargetGroup } from "./overview-model";
import { buildWorkflowLanes, type WorkflowLane } from "./workflows-model";

export const RECENT_SESSIONS = 5;

/** Operator agents with the version a new session runs on (live, else newest). */
export async function loadOperatorAgentOptions(companyId: string): Promise<OperatorAgentOption[]> {
  const rows = await db.query.agents.findMany({
    where: and(eq(agents.companyId, companyId), eq(agents.kind, "operator")),
    columns: { id: true, name: true },
    orderBy: (a, { asc }) => [asc(a.name)],
  });
  if (rows.length === 0) return [];
  const versions = await db.query.agentVersions.findMany({
    where: inArray(
      agentVersions.agentId,
      rows.map((a) => a.id),
    ),
    columns: { id: true, agentId: true, name: true, status: true },
    orderBy: (v, { desc }) => [desc(v.createdAt)],
  });
  return rows.map((agent) => {
    const own = versions.filter((v) => v.agentId === agent.id);
    const pick = own.find((v) => v.status === "live") ?? own[0] ?? null;
    return {
      id: agent.id,
      name: agent.name,
      version: pick ? { id: pick.id, name: pick.name, status: pick.status } : null,
    };
  });
}

/** Dialog chips and options for a company (workflows + operator agents). */
export async function loadSessionTargets(
  companyId: string,
  workflows?: WorkflowView[],
  agents?: OperatorAgentOption[],
): Promise<SessionTargetGroup[]> {
  const [views, agentOptions] = await Promise.all([
    workflows ?? workflowsReader.listWorkflows(companyId),
    agents ?? loadOperatorAgentOptions(companyId),
  ]);
  return buildSessionTargets(views, agentOptions);
}

export type OperatorOverviewData = {
  needsYou: NeedsYouList;
  kpis: CompanyKpis | null;
  /** Weekly qualified-lead target of the lead workflow; null when none is set. */
  leadTarget: number | null;
  workflows: WorkflowView[];
  /** Workflows canvas lanes (S41). */
  lanes: WorkflowLane[];
  targets: SessionTargetGroup[];
  recent: SessionListRow[];
  totalSessions: number;
};

export async function loadOperatorOverview(args: {
  companyId: string;
  viewerId: string;
  ownerId: string;
  now: Date;
}): Promise<OperatorOverviewData> {
  const { companyId } = args;
  const [needsYou, kpis, workflows, sessions, agentOptions] = await Promise.all([
    getNeedsYou({ companyId, viewerId: args.viewerId, ownerId: args.ownerId }),
    getCompanyKpis(companyId, args.now),
    workflowsReader.listWorkflows(companyId),
    loadOperatorSessions(companyId),
    loadOperatorAgentOptions(companyId),
  ]);
  const targets = await loadSessionTargets(companyId, workflows, agentOptions);
  const lead = workflows.find((w) => w.target?.metricKey === "leads.qualified_delivered");
  return {
    needsYou,
    kpis,
    leadTarget: lead?.target?.weeklyTarget ?? null,
    workflows,
    lanes: buildWorkflowLanes(workflows, agentOptions),
    targets,
    recent: sessions.rows.slice(0, RECENT_SESSIONS),
    totalSessions: sessions.rows.length,
  };
}
