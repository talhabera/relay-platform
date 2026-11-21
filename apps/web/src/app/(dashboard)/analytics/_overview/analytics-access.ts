import { eq } from "drizzle-orm";

import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { listAccessibleCompanies, resolveActiveCompanyId } from "@/lib/operator/companies";
import { resolvePagePermissions } from "@/lib/page-access";
import type { Company } from "@/types";

export type AnalyticsAccess =
  | { kind: "no-company"; isOwner: boolean }
  | { kind: "restricted"; isOwner: boolean; company: Company }
  | { kind: "ok"; isOwner: boolean; company: Company };

/**
 * The company Analytics shows and whether the user may see it: the active
 * company from preferences among the companies the user owns or is a member
 * of, gated by the `analytics` page permission (owners always pass). The
 * page and the export route share this so they can never disagree.
 */
export async function resolveAnalyticsAccess(userId: string): Promise<AnalyticsAccess> {
  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  const accessible = await listAccessibleCompanies(userId);
  const isOwner = accessible.some((company) => company.ownerId === userId);
  const activeId = resolveActiveCompanyId(prefs?.activeCompanyId, accessible);
  const company = activeId ? accessible.find((c) => c.id === activeId) : undefined;
  if (!company) return { kind: "no-company", isOwner };

  const permissions = await resolvePagePermissions(userId, company);
  return permissions.analytics ? { kind: "ok", isOwner, company } : { kind: "restricted", isOwner, company };
}
