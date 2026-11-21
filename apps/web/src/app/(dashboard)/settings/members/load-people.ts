import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agents, companyMembers, operatorAgentEditors, users } from "@/db/schema";

import { buildCompanyPeople, type CompanyPerson } from "./people";

/**
 * Everyone on `company` (owner, members, client users) with their approve-on agents. Callers
 * must have passed `requireCompanyAccess` (owner-only) first. Null when the owner row is gone.
 */
export async function loadCompanyPeople(company: {
  id: string;
  name: string;
  ownerId: string;
}): Promise<CompanyPerson[] | null> {
  const [members, owner, operatorAgents] = await Promise.all([
    db.query.companyMembers.findMany({
      where: eq(companyMembers.companyId, company.id),
      with: { user: true },
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    }),
    db.query.users.findFirst({ where: eq(users.id, company.ownerId) }),
    db.query.agents.findMany({
      where: and(eq(agents.companyId, company.id), eq(agents.kind, "operator")),
      columns: { id: true, name: true, createdByUserId: true },
      orderBy: (a, { asc }) => [asc(a.name)],
    }),
  ]);
  if (!owner) return null;

  const agentUsers =
    operatorAgents.length > 0
      ? await db
          .select({
            agentId: operatorAgentEditors.agentId,
            userId: operatorAgentEditors.userId,
            canApprove: operatorAgentEditors.canApprove,
          })
          .from(operatorAgentEditors)
          .where(
            inArray(
              operatorAgentEditors.agentId,
              operatorAgents.map((a) => a.id),
            ),
          )
      : [];

  return buildCompanyPeople({
    company,
    owner,
    members,
    agents: operatorAgents,
    agentUsers,
  });
}
