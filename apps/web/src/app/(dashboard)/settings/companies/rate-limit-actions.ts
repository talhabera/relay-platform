"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { invalidateCompanyOverrides } from "@relay/db/rate-limit";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { requireCompanyAccess } from "@/lib/authorization";
import { normalizeRateLimitSettings } from "@/lib/company/rate-limit-settings";
import {
  updateCompanyRateLimitsSchema,
  type UpdateCompanyRateLimitsInput,
} from "@/lib/validators/company";

/**
 * Replaces the company's rate-limit settings. Owner only. Keys left out fall
 * back to the platform default. Other processes pick the change up within
 * the 30s settings cache.
 */
export async function updateCompanyRateLimits(
  companyId: string,
  data: UpdateCompanyRateLimitsInput,
) {
  await requireCompanyAccess(companyId);
  const parsed = updateCompanyRateLimitsSchema.parse(data);
  const rateLimits = normalizeRateLimitSettings(parsed);

  await db
    .update(companies)
    .set({ rateLimits, updatedAt: new Date() })
    .where(eq(companies.id, companyId));

  invalidateCompanyOverrides(companyId);
  revalidatePath(`/settings/companies/${companyId}`);
  return { rateLimits };
}
