import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { companyMembers, userPreferences } from "@/db/schema";
import { listAccessibleCompanies, resolveActiveCompanyId } from "@/lib/operator/companies";

/**
 * The company a portal viewer sees: a client user's single client membership
 * (spec client-role-and-portal, decision 2); for the owner / member preview,
 * their active company. Shared by every `/client/*` page.
 */
export async function resolvePortalCompanyId(userId: string): Promise<string | null> {
  const client = await db.query.companyMembers.findFirst({
    columns: { companyId: true },
    where: and(eq(companyMembers.userId, userId), eq(companyMembers.role, "client")),
  });
  if (client) return client.companyId;

  const [prefs] = await db
    .select({ activeCompanyId: userPreferences.activeCompanyId })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  const companies = await listAccessibleCompanies(userId);
  return resolveActiveCompanyId(prefs?.activeCompanyId, companies);
}
