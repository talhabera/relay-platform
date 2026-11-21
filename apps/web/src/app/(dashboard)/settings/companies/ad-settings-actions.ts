"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { requireCompanyAccess } from "@/lib/authorization";
import {
  updateCompanyAdSettingsSchema,
  type UpdateCompanyAdSettingsInput,
} from "@/lib/validators/company";

/**
 * Replaces the company's ad settings (monthly target, CPL stop threshold,
 * daily cap, per-month capacities). Owner only. Money arrives as whole
 * minor units (kuruş); null clears a field, which consumers read as unset.
 */
export async function updateCompanyAdSettings(
  companyId: string,
  data: UpdateCompanyAdSettingsInput,
) {
  await requireCompanyAccess(companyId);
  const parsed = updateCompanyAdSettingsSchema.parse(data);

  await db
    .update(companies)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(companies.id, companyId));

  revalidatePath(`/settings/companies/${companyId}`);
  return { adSettings: parsed };
}
