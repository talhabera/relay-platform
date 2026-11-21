import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { agentHandoffSettings, agents, agentVersions, channels, knowledgeBase } from "@/db/schema";
import type { WorkflowView } from "@/lib/fixtures/interfaces";

import { buildAgentMap, type AgentMapModel } from "./agent-map-model";

/** Agents, their channels and live versions for the Home agent map; workflows come from Home's one read. */
export async function loadAgentMap(companyId: string, workflows: readonly WorkflowView[]): Promise<AgentMapModel | null> {
  const agentRows = await db
    .select({
      id: agents.id,
      name: agents.name,
      kind: agents.kind,
      model: agents.model,
      isActive: agents.isActive,
    })
    .from(agents)
    .where(eq(agents.companyId, companyId))
    .orderBy(asc(agents.createdAt));
  if (agentRows.length === 0) return null;

  const customerIds = agentRows.filter((a) => a.kind === "customer").map((a) => a.id);
  const operatorIds = agentRows.filter((a) => a.kind === "operator").map((a) => a.id);

  const [channelRows, liveRows, kb, handoff] = await Promise.all([
    customerIds.length === 0
      ? []
      : db
          .select({ agentId: channels.agentId, type: channels.type, status: channels.status })
          .from(channels)
          .where(inArray(channels.agentId, customerIds)),
    operatorIds.length === 0
      ? []
      : db
          .select({ agentId: agentVersions.agentId, name: agentVersions.name, model: agentVersions.model })
          .from(agentVersions)
          .where(and(inArray(agentVersions.agentId, operatorIds), eq(agentVersions.status, "live"))),
    db.select({ id: knowledgeBase.id }).from(knowledgeBase).where(eq(knowledgeBase.companyId, companyId)).limit(1),
    customerIds.length === 0
      ? []
      : db
          .select({ agentId: agentHandoffSettings.agentId })
          .from(agentHandoffSettings)
          .where(inArray(agentHandoffSettings.agentId, customerIds))
          .limit(1),
  ]);
  const live = new Map(liveRows.map((v) => [v.agentId, v]));

  return buildAgentMap({
    agents: agentRows.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      // Operator agents run their live version's model.
      model: live.get(a.id)?.model ?? a.model,
      isActive: a.isActive ?? true,
      liveVersion: live.get(a.id)?.name ?? null,
    })),
    channels: channelRows.map((c) => ({ agentId: c.agentId, type: c.type, active: c.status !== "inactive" })),
    workflows,
    hasKnowledgeBase: kb.length > 0,
    hasHandoff: handoff.length > 0,
  });
}
