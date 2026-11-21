"use server";

import {
  addCompanyMember,
  removeCompanyMember,
  updateCompanyMemberPermissions,
} from "../companies/actions";

/**
 * Result-returning wrappers over the owner-only member actions. Next.js redacts errors thrown
 * from server actions in production, so the Members dialogs (Figma members-unknown-email, the
 * one-membership refusal) need the message as data. Authz stays in the wrapped actions
 * (`requireCompanyAccess`).
 */
export type MemberActionResult =
  | { ok: true }
  | { ok: false; field: "email" | null; message: string };

/** Known refusals, shown as-is. Anything else is a generic failure. */
const EMAIL_ERRORS: Record<string, string> = {
  "No Relay user with that email": "No user with that email",
  "Owner is already a member": "This person owns the company",
  "Already a member": "Already a member",
  "A client user can hold only one membership; this user already belongs to a company":
    "A client user can hold only one membership; this user already belongs to a company",
  "This user is a client of another company and cannot be added as a member":
    "This user is a client of another company and cannot be added as a member",
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function isValidationError(error: unknown): boolean {
  return error instanceof Error && error.name === "ZodError";
}

export async function inviteMember(
  companyId: string,
  email: string,
  role: "member" | "client",
): Promise<MemberActionResult> {
  try {
    await addCompanyMember(companyId, email, role);
    return { ok: true };
  } catch (error) {
    const message = messageOf(error);
    const known = EMAIL_ERRORS[message];
    if (known) return { ok: false, field: "email", message: known };
    if (isValidationError(error)) {
      return { ok: false, field: "email", message: "Enter a valid email" };
    }
    if (message.startsWith("Unauthorized")) {
      return { ok: false, field: null, message: "Only the company owner can add people" };
    }
    throw error;
  }
}

export async function removeMember(
  companyId: string,
  userId: string,
): Promise<MemberActionResult> {
  try {
    await removeCompanyMember(companyId, userId);
    return { ok: true };
  } catch (error) {
    const message = messageOf(error);
    if (message === "Cannot remove the company owner") {
      return { ok: false, field: null, message };
    }
    if (message.startsWith("Unauthorized")) {
      return { ok: false, field: null, message: "Only the company owner can remove people" };
    }
    throw error;
  }
}

export async function setMemberPageAccess(
  companyId: string,
  userId: string,
  permissions: unknown,
): Promise<MemberActionResult> {
  try {
    await updateCompanyMemberPermissions(companyId, userId, permissions);
    return { ok: true };
  } catch (error) {
    const message = messageOf(error);
    if (message === "Member not found" || message === "Owner already has access to every page") {
      return { ok: false, field: null, message };
    }
    if (message.startsWith("Unauthorized")) {
      return { ok: false, field: null, message: "Only the company owner changes access" };
    }
    throw error;
  }
}
