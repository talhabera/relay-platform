import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { listAccessibleCompanies, resolveActiveCompanyId } from "@/lib/operator/companies";

/**
 * The active company for the Settings "Company" section, and whether the user owns it.
 * `company` is null when the user has no accessible company.
 */
export async function resolveSettingsCompany(userId: string) {
  const [companies, prefs] = await Promise.all([
    listAccessibleCompanies(userId),
    db.query.userPreferences.findFirst({
      where: eq(userPreferences.userId, userId),
    }),
  ]);
  const activeId = resolveActiveCompanyId(prefs?.activeCompanyId, companies);
  const company = companies.find((c) => c.id === activeId) ?? null;
  return {
    company,
    isOwner: company !== null && company.ownerId === userId,
    ownsAny: companies.some((c) => c.ownerId === userId),
  };
}
