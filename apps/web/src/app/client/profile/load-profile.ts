import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/auth-server";
import { loadClientNotifications, type ClientNotificationState } from "@/lib/client/notifications-data";
import { resolvePortalCompanyId } from "@/lib/client/portal";
import { requireClientAccess, type CompanyAccessRole } from "@/lib/operator/access";

export type ClientProfileData =
  | { kind: "no-company" }
  | {
      kind: "profile";
      company: { id: string; name: string };
      role: CompanyAccessRole;
      user: { name: string; email: string; image: string | null; whatsappNumber: string | null };
    };

/** Session → portal company → `requireClientAccess` → the viewer's own profile row. */
export async function loadClientProfile(): Promise<ClientProfileData> {
  const session = await requireSession();
  const companyId = await resolvePortalCompanyId(session.user.id);
  if (!companyId) return { kind: "no-company" };

  const { company, role } = await requireClientAccess(companyId);
  const [row] = await db
    .select({ whatsappNumber: users.whatsappNumber })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  return {
    kind: "profile",
    company: { id: company.id, name: company.name },
    role,
    user: {
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
      whatsappNumber: row?.whatsappNumber ?? null,
    },
  };
}

export type ClientNotificationsPageData =
  | { kind: "no-company" }
  | { kind: "notifications"; company: { id: string; name: string }; role: CompanyAccessRole; state: ClientNotificationState };

export async function loadClientNotificationsPage(): Promise<ClientNotificationsPageData> {
  const session = await requireSession();
  const companyId = await resolvePortalCompanyId(session.user.id);
  if (!companyId) return { kind: "no-company" };

  const { company, role } = await requireClientAccess(companyId);
  const state = await loadClientNotifications(session.user.id, company.id);
  return { kind: "notifications", company: { id: company.id, name: company.name }, role, state };
}

export const ROLE_LABELS: Record<CompanyAccessRole, string> = {
  client: "Client",
  member: "Member",
  owner: "Owner",
};
