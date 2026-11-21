import { count, eq, inArray } from "drizzle-orm";
import { getPackageDefinition } from "@relay/db";
import { db } from "@/db";
import { agents, chats, companyMembers, cronJobs, workflows } from "@/db/schema";

import type { CompanyAgentCounts, CompanyDeleteImpact } from "./company-view";

/** Customer and operator agent counts per company id (missing ids count zero). */
export async function loadAgentCounts(
  companyIds: string[],
): Promise<Map<string, CompanyAgentCounts>> {
  const byId = new Map<string, CompanyAgentCounts>();
  for (const id of companyIds) byId.set(id, { customer: 0, operator: 0 });
  if (companyIds.length === 0) return byId;

  const rows = await db
    .select({ companyId: agents.companyId, kind: agents.kind, n: count() })
    .from(agents)
    .where(inArray(agents.companyId, companyIds))
    .groupBy(agents.companyId, agents.kind);

  for (const row of rows) {
    const counts = byId.get(row.companyId);
    if (counts) counts[row.kind] = Number(row.n);
  }
  return byId;
}

/** Everything deleting the company cascades to (FKs on `company_id` are `on delete cascade`). */
export async function loadDeleteImpact(companyId: string): Promise<CompanyDeleteImpact> {
  const [agentCounts, [chatRow], [jobRow], workflowRows, [memberRow]] = await Promise.all([
    loadAgentCounts([companyId]),
    db.select({ n: count() }).from(chats).where(eq(chats.companyId, companyId)),
    db.select({ n: count() }).from(cronJobs).where(eq(cronJobs.companyId, companyId)),
    db
      .selectDistinct({ slug: workflows.packageSlug })
      .from(workflows)
      .where(eq(workflows.companyId, companyId)),
    db.select({ n: count() }).from(companyMembers).where(eq(companyMembers.companyId, companyId)),
  ]);
  const agentsOf = agentCounts.get(companyId) ?? { customer: 0, operator: 0 };

  return {
    customerAgents: agentsOf.customer,
    operatorAgents: agentsOf.operator,
    conversations: Number(chatRow?.n ?? 0),
    schedules: Number(jobRow?.n ?? 0),
    packages: workflowRows.map((row) => getPackageDefinition(row.slug)?.name ?? row.slug),
    members: Number(memberRow?.n ?? 0),
  };
}
