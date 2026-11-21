import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, type LeadStatus } from "@/db/schema";

/** One page is enough for v1; the page says so when it is hit. */
export const LEAD_LIST_LIMIT = 500;

const STATUSES: readonly LeadStatus[] = ["new", "qualified", "rejected"];

export function parseLeadStatus(value: string | null): LeadStatus | undefined {
  return STATUSES.find((status) => status === value);
}

interface LeadAgentScope {
  id: string;
  companyId: string;
}

/**
 * Every read filters by company and agent together. `agent` must come from
 * `requireAgentAccess`; the company id is never taken from the request.
 */
function agentLeadsQuery(agent: LeadAgentScope, status?: LeadStatus) {
  return db
    .select()
    .from(leads)
    .where(
      and(
        eq(leads.companyId, agent.companyId),
        eq(leads.agentId, agent.id),
        status ? eq(leads.status, status) : undefined,
      ),
    )
    .orderBy(desc(leads.createdAt));
}

/** The page: the latest `LEAD_LIST_LIMIT` leads. */
export async function listAgentLeads(
  agent: LeadAgentScope,
  status?: LeadStatus,
) {
  return agentLeadsQuery(agent, status).limit(LEAD_LIST_LIMIT);
}

/**
 * The CSV export: every lead, no cap. It is what gets billed, so it must not
 * inherit the page's window.
 */
export async function exportAgentLeads(
  agent: LeadAgentScope,
  status?: LeadStatus,
) {
  return agentLeadsQuery(agent, status);
}

export async function countAgentLeadsByStatus(
  agent: LeadAgentScope,
): Promise<Record<LeadStatus, number>> {
  const rows = await db
    .select({ status: leads.status, count: count() })
    .from(leads)
    .where(
      and(eq(leads.companyId, agent.companyId), eq(leads.agentId, agent.id)),
    )
    .groupBy(leads.status);

  const counts: Record<LeadStatus, number> = { new: 0, qualified: 0, rejected: 0 };
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}
