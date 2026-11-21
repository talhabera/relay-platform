"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { requireCompanyAccess } from "@/lib/authorization";

import { resolveSettingsCompany } from "../active-company";
import { loadDeleteImpact } from "./companies-data";
import {
  currentCompanyDeleteHint,
  needsTypedConfirm,
  typedNameMatches,
  type CompanyDeleteImpact,
} from "./company-view";

/** Impact summary for the delete dialog. Owner-only. */
export async function getCompanyDeleteImpact(companyId: string): Promise<CompanyDeleteImpact> {
  await requireCompanyAccess(companyId);
  return loadDeleteImpact(companyId);
}

/**
 * Figma `companies-delete` / `companies-delete-typed`. Owner-only; refuses the active company
 * (switch first) and, when the company holds anything, a name that was not typed exactly.
 */
export async function deleteCompanyConfirmed(input: {
  companyId: string;
  confirmName?: string;
}): Promise<{ ok: true } | { error: string }> {
  const { session, company } = await requireCompanyAccess(input.companyId);

  const { company: active } = await resolveSettingsCompany(session.user.id);
  if (active?.id === company.id) {
    return { error: currentCompanyDeleteHint(company.name) };
  }

  const impact = await loadDeleteImpact(company.id);
  if (needsTypedConfirm(impact) && !typedNameMatches(input.confirmName ?? "", company.name)) {
    return { error: `Type ${company.name} to confirm` };
  }

  await db.delete(companies).where(eq(companies.id, company.id));

  revalidatePath("/settings/companies");
  revalidatePath("/home");
  return { ok: true };
}
