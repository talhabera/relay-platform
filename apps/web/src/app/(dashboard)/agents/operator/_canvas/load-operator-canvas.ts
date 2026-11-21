import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  agents,
  agentVersions,
  integrations,
  normalizeToolToggles,
  workflowStages,
  workflows,
} from "@/db/schema";

import { buildOperatorCanvas, type OperatorCanvasModel } from "./operator-canvas-model";

/** Operator agents of one company with their versions, the company connectors and workflow stages. */
export async function loadOperatorCanvas(
  companyId: string,
  selectedAgentId: string | undefined,
  focusVersionId: string | undefined,
): Promise<OperatorCanvasModel> {
  const agentRows = await db
    .select({ id: agents.id, name: agents.name, description: agents.description, isActive: agents.isActive })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "operator")))
    .orderBy(agents.createdAt);

  const ids = agentRows.map((a) => a.id);

  const [versionRows, integrationRows, stageRows] = await Promise.all([
    ids.length === 0
      ? []
      : db
          .select({
            id: agentVersions.id,
            agentId: agentVersions.agentId,
            name: agentVersions.name,
            status: agentVersions.status,
            model: agentVersions.model,
            parentVersionId: agentVersions.parentVersionId,
            changeNote: agentVersions.changeNote,
            toolToggles: agentVersions.toolToggles,
            createdAt: agentVersions.createdAt,
          })
          .from(agentVersions)
          .where(inArray(agentVersions.agentId, ids)),
    db
      .select({ type: integrations.type, agentId: integrations.agentId, status: integrations.status })
      .from(integrations)
      .where(eq(integrations.companyId, companyId)),
    ids.length === 0
      ? []
      : db
          .select({ agentId: workflowStages.agentId, stageName: workflowStages.name, workflowName: workflows.name })
          .from(workflowStages)
          .innerJoin(workflows, eq(workflows.id, workflowStages.workflowId))
          .where(inArray(workflowStages.agentId, ids))
          .orderBy(workflows.name, workflowStages.order),
  ]);

  return buildOperatorCanvas(
    {
      agents: agentRows.map((a) => ({ ...a, isActive: a.isActive ?? true })),
      versions: versionRows.map((v) => ({ ...v, toolToggles: normalizeToolToggles(v.toolToggles) })),
      integrations: integrationRows.map((i) => ({ ...i, status: i.status ?? "pending" })),
      stages: stageRows.flatMap((s) => (s.agentId ? [{ ...s, agentId: s.agentId }] : [])),
    },
    selectedAgentId,
    focusVersionId,
  );
}
