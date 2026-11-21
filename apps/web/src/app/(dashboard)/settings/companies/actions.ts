"use server";

import { revalidatePath } from "next/cache";
import crypto from "crypto";
import { db } from "@/db";
import {
  companies,
  widgetConfigs,
  userPreferences,
  agents,
  companyMembers,
  operatorAgentEditors,
  users,
  DEFAULT_PAGE_PERMISSIONS,
  normalizePagePermissions,
  type CompanyMemberRole,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireSession } from "@/lib/auth-server";
import { requireCompanyAccess } from "@/lib/authorization";
import {
  assertMembershipInviteAllowed,
  requireCompanyMembership,
} from "@/lib/operator/access";
import {
  createCompanySchema,
  updateCompanySchema,
  updateWidgetConfigSchema,
  type CreateCompanyInput,
  type UpdateCompanyInput,
  type UpdateWidgetConfigInput,
} from "@/lib/validators/company";
import {
  addCompanyMemberSchema,
  companyMemberRoleSchema,
  updateCompanyMemberPermissionsSchema,
} from "@/lib/validators/company-member";

export async function createCompany(data: CreateCompanyInput) {
  const session = await requireSession();
  const parsed = createCompanySchema.parse(data);

  const [company] = await db
    .insert(companies)
    .values({
      name: parsed.name,
      industry: parsed.industry ?? null,
      description: parsed.description ?? null,
      ownerId: session.user.id,
    })
    .returning({ id: companies.id });

  // Create userPreferences if none exist (first company)
  const existingPrefs = await db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, session.user.id),
  });

  if (!existingPrefs) {
    await db.insert(userPreferences).values({
      userId: session.user.id,
      activeCompanyId: company.id,
    });
  }

  revalidatePath("/settings/companies");
  revalidatePath("/home");

  return { id: company.id };
}

export async function updateCompany(id: string, data: UpdateCompanyInput) {
  await requireCompanyAccess(id);
  const parsed = updateCompanySchema.parse(data);

  await db
    .update(companies)
    .set({
      ...parsed,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, id));

  revalidatePath("/settings/companies");
  revalidatePath(`/settings/companies/${id}`);
}

export async function deleteCompany(id: string) {
  await requireCompanyAccess(id);

  await db.delete(companies).where(eq(companies.id, id));

  revalidatePath("/settings/companies");
  revalidatePath("/home");
}

export async function updateWidgetConfig(
  companyId: string,
  data: UpdateWidgetConfigInput
) {
  await requireCompanyAccess(companyId);
  const parsed = updateWidgetConfigSchema.parse(data);

  if (parsed.agentId) {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, parsed.agentId),
    });

    if (
      !agent ||
      agent.companyId !== companyId ||
      agent.kind !== "customer"
    ) {
      throw new Error("Widget agent must be a customer agent");
    }
  }

  // Check if widget config exists
  const existing = await db.query.widgetConfigs.findFirst({
    where: eq(widgetConfigs.companyId, companyId),
  });

  if (existing) {
    await db
      .update(widgetConfigs)
      .set({
        ...parsed,
        updatedAt: new Date(),
      })
      .where(eq(widgetConfigs.companyId, companyId));
  } else {
    await db.insert(widgetConfigs).values({
      companyId,
      ...parsed,
    });
  }

  revalidatePath(`/settings/companies/${companyId}`);
}

export async function generateWidgetId(companyId: string) {
  await requireCompanyAccess(companyId);

  const widgetId = crypto.randomBytes(16).toString("hex");

  await db
    .update(companies)
    .set({
      widgetId,
      updatedAt: new Date(),
    })
    .where(eq(companies.id, companyId));

  revalidatePath(`/settings/companies/${companyId}`);

  return { widgetId };
}

export async function setActiveCompany(companyId: string) {
  const { session } = await requireCompanyMembership(companyId);

  const existingPrefs = await db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, session.user.id),
  });

  if (existingPrefs) {
    await db
      .update(userPreferences)
      .set({
        activeCompanyId: companyId,
        updatedAt: new Date(),
      })
      .where(eq(userPreferences.userId, session.user.id));
  } else {
    await db.insert(userPreferences).values({
      userId: session.user.id,
      activeCompanyId: companyId,
    });
  }

  revalidatePath("/home");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

// company_members_client_user_uidx (migration 0030): a second client row for
// one user, from two client invites that raced past the app-level check.
function isClientMembershipViolation(error: unknown): boolean {
  return (
    isUniqueViolation(error) &&
    typeof error === "object" &&
    error !== null &&
    "constraint_name" in error &&
    error.constraint_name === "company_members_client_user_uidx"
  );
}

/**
 * Owner-only invite (`requireCompanyAccess`) with a role picked at invite. One
 * membership per client user: `assertMembershipInviteAllowed` refuses a client
 * invite for anyone already in a company, and a member invite for a client.
 */
export async function addCompanyMember(
  companyId: string,
  email: string,
  role: CompanyMemberRole = "member",
) {
  const { company } = await requireCompanyAccess(companyId);
  const parsed = addCompanyMemberSchema.parse({ companyId, email });
  const memberRole = companyMemberRoleSchema.parse(role);

  const user = await db.query.users.findFirst({
    where: eq(users.email, parsed.email),
  });

  if (!user) {
    throw new Error("No Relay user with that email");
  }

  if (user.id === company.ownerId) {
    throw new Error("Owner is already a member");
  }

  await assertMembershipInviteAllowed(user.id, memberRole);

  try {
    await db.insert(companyMembers).values({
      companyId: parsed.companyId,
      userId: user.id,
      role: memberRole,
      // A client row ignores pagePermissions; store the defaults, never read them.
      pagePermissions: DEFAULT_PAGE_PERMISSIONS,
    });
  } catch (error) {
    if (isClientMembershipViolation(error)) {
      // Same message assertMembershipInviteAllowed throws for this case.
      throw new Error(
        "A client user can hold only one membership; this user already belongs to a company",
      );
    }
    if (isUniqueViolation(error)) {
      throw new Error("Already a member");
    }
    throw error;
  }

  revalidatePath(`/settings/companies/${companyId}`);
  revalidatePath("/settings/members");
}

export async function removeCompanyMember(companyId: string, userId: string) {
  const { company } = await requireCompanyAccess(companyId);

  if (userId === company.ownerId) {
    throw new Error("Cannot remove the company owner");
  }

  const companyAgents = await db.query.agents.findMany({
    where: eq(agents.companyId, companyId),
    columns: { id: true },
  });
  const agentIds = companyAgents.map((agent) => agent.id);

  if (agentIds.length > 0) {
    await db
      .delete(operatorAgentEditors)
      .where(
        and(
          eq(operatorAgentEditors.userId, userId),
          inArray(operatorAgentEditors.agentId, agentIds),
        ),
      );
  }

  await db
    .delete(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.userId, userId),
      ),
    );

  revalidatePath(`/settings/companies/${companyId}`);
  revalidatePath("/settings/members");
}

export async function updateCompanyMemberPermissions(
  companyId: string,
  userId: string,
  permissions: unknown,
) {
  const { company } = await requireCompanyAccess(companyId);
  const parsed = updateCompanyMemberPermissionsSchema.parse({
    companyId,
    userId,
    permissions,
  });

  if (parsed.userId === company.ownerId) {
    throw new Error("Owner already has access to every page");
  }

  const member = await db.query.companyMembers.findFirst({
    where: and(
      eq(companyMembers.companyId, parsed.companyId),
      eq(companyMembers.userId, parsed.userId),
    ),
  });

  if (!member) {
    throw new Error("Member not found");
  }

  await db
    .update(companyMembers)
    .set({
      pagePermissions: normalizePagePermissions(parsed.permissions),
    })
    .where(eq(companyMembers.id, member.id));

  revalidatePath(`/settings/companies/${companyId}`);
  revalidatePath("/settings/members");
  revalidatePath("/home");
  revalidatePath("/operator");
}
