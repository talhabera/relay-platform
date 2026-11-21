import { and, eq } from "drizzle-orm";
import { getPackageDefinition } from "@relay/db";
import { db } from "@/db";
import { agents, agentVersions, workflowStages, workflows } from "@/db/schema";

import type { ConnectorUser } from "./connector-view";

/**
 * Operator agents of a company, with their live version and installing package. Every operator
 * agent gets the research tools (worker `applyResearchTools`), so each one uses every connector.
 */
export async function loadConnectorUsers(companyId: string): Promise<ConnectorUser[]> {
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      version: agentVersions.name,
      packageSlug: workflows.packageSlug,
    })
    .from(agents)
    .leftJoin(
      agentVersions,
      and(eq(agentVersions.agentId, agents.id), eq(agentVersions.status, "live")),
    )
    .leftJoin(workflowStages, eq(workflowStages.agentId, agents.id))
    .leftJoin(workflows, eq(workflows.id, workflowStages.workflowId))
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "operator")))
    .orderBy(agents.name);

  const byId = new Map<string, ConnectorUser>();
  for (const row of rows) {
    if (byId.has(row.id)) continue;
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      version: row.version ?? undefined,
      packageName: row.packageSlug
        ? (getPackageDefinition(row.packageSlug)?.name ?? row.packageSlug)
        : undefined,
    });
  }
  return [...byId.values()];
}
