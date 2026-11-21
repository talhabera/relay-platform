import { db } from "@/db";
import { companies, companyMembers } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import type { Company } from "@/types";

export async function listAccessibleCompanies(
  userId: string,
): Promise<Company[]> {
  const owned = await db.query.companies.findMany({
    where: eq(companies.ownerId, userId),
  });

  // Client rows reach only the client portal: no company switcher, no
  // dashboard shell.
  const memberships = await db.query.companyMembers.findMany({
    where: and(
      eq(companyMembers.userId, userId),
      ne(companyMembers.role, "client"),
    ),
    with: { company: true },
  });

  const byId = new Map<string, Company>();
  for (const company of owned) {
    byId.set(company.id, company);
  }
  for (const membership of memberships) {
    byId.set(membership.company.id, membership.company);
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function resolveActiveCompanyId(
  prefsActiveCompanyId: string | null | undefined,
  accessibleCompanies: { id: string }[],
): string | null {
  if (
    prefsActiveCompanyId &&
    accessibleCompanies.some((company) => company.id === prefsActiveCompanyId)
  ) {
    return prefsActiveCompanyId;
  }

  return accessibleCompanies[0]?.id ?? null;
}
