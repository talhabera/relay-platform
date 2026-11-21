import { db } from "@/db";
import {
  companyMembers,
  normalizePagePermissions,
  OWNER_PAGE_PERMISSIONS,
  type PagePermissionKey,
  type PagePermissions,
} from "@/db/schema";
import { isCompanyOwner, requireCompanyMembership } from "@/lib/operator/access";
import { and, eq } from "drizzle-orm";
import { pagePermissionLabel } from "@/lib/page-permission-catalog";

export type { PagePermissionKey, PagePermissions };
export { pagePermissionLabel, PAGE_PERMISSION_CATALOG } from "@/lib/page-permission-catalog";

export function deniedPageAccessMessage(page: PagePermissionKey | undefined): string {
  if (!page) return "Unauthorized: Only Home is available to you";
  return `Unauthorized: You don't have ${pagePermissionLabel(page)} access`;
}

// A client row ignores stored grants (spec 2026-10-02-client-role-and-portal,
// decision 1): the portal is gated by requireClientAccess, not page keys.
function membershipPermissions(
  member: { role?: string | null; pagePermissions?: Partial<PagePermissions> | null } | undefined,
): PagePermissions {
  if (member?.role === "client") return normalizePagePermissions(null);
  return normalizePagePermissions(member?.pagePermissions);
}

export async function resolvePagePermissions(
  userId: string,
  company: { id: string; ownerId: string },
): Promise<PagePermissions> {
  if (isCompanyOwner(userId, company)) {
    return OWNER_PAGE_PERMISSIONS;
  }

  const member = await db.query.companyMembers.findFirst({
    where: and(
      eq(companyMembers.companyId, company.id),
      eq(companyMembers.userId, userId),
    ),
  });

  return membershipPermissions(member);
}

export async function listPagePermissionsByCompanyId(
  userId: string,
  companies: { id: string; ownerId: string }[],
): Promise<Record<string, PagePermissions>> {
  const memberships = await db.query.companyMembers.findMany({
    where: eq(companyMembers.userId, userId),
  });
  const byCompanyId = new Map(
    memberships.map((membership) => [membership.companyId, membership]),
  );

  const result: Record<string, PagePermissions> = {};
  for (const company of companies) {
    if (isCompanyOwner(userId, company)) {
      result[company.id] = OWNER_PAGE_PERMISSIONS;
      continue;
    }
    result[company.id] = membershipPermissions(byCompanyId.get(company.id));
  }
  return result;
}

export async function assertPageAccess(
  userId: string,
  company: { id: string; ownerId: string },
  pages: PagePermissionKey[],
): Promise<PagePermissions> {
  const permissions = await resolvePagePermissions(userId, company);
  const allowed = pages.some((page) => permissions[page]);
  if (!allowed) {
    throw new Error(deniedPageAccessMessage(pages[0]));
  }
  return permissions;
}

export async function requirePageAccess(
  companyId: string,
  page: PagePermissionKey,
) {
  const { session, company } = await requireCompanyMembership(companyId);
  const permissions = await assertPageAccess(session.user.id, company, [page]);
  return { session, company, permissions };
}

export async function requireAnyPageAccess(
  companyId: string,
  pages: PagePermissionKey[],
) {
  const { session, company } = await requireCompanyMembership(companyId);
  const permissions = await assertPageAccess(session.user.id, company, pages);
  return { session, company, permissions };
}
