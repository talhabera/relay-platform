import { z } from "zod";

export const addCompanyMemberSchema = z.object({
  companyId: z.string().uuid(),
  email: z
    .string()
    .trim()
    .email()
    .transform((e) => e.toLowerCase()),
});

export type AddCompanyMemberInput = z.infer<typeof addCompanyMemberSchema>;

/**
 * Role picked at invite and fixed afterwards (client role spec decision 1).
 * Mirrors `COMPANY_MEMBER_ROLES` in @relay/db; kept local so this file stays
 * safe for the client bundle.
 */
export const companyMemberRoleSchema = z.enum(["member", "client"]);

export const pagePermissionsSchema = z.object({
  operator: z.boolean(),
  agents: z.boolean(),
  messaging: z.boolean(),
  analytics: z.boolean(),
});

export type PagePermissionsInput = z.infer<typeof pagePermissionsSchema>;

export const updateCompanyMemberPermissionsSchema = z.object({
  companyId: z.string().uuid(),
  userId: z.string().min(1),
  permissions: pagePermissionsSchema,
});

export type UpdateCompanyMemberPermissionsInput = z.infer<
  typeof updateCompanyMemberPermissionsSchema
>;
