"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { adMetaMappings } from "@/db/schema";
import { requireCompanyAccess } from "@/lib/authorization";
import {
  adMetaMappingSchema,
  type AdMetaMappingInput,
} from "@/lib/validators/company";

/**
 * Owner-only writes for the Meta ad mapping list. This screen is the only
 * writer of `ad_meta_mappings`; RL6 and the webhook side only read it.
 * Validation and duplicate failures come back as field errors for the form;
 * access failures throw like every other settings action.
 */
export type AdMetaMappingResult =
  | { ok: true }
  | {
      ok: false;
      fieldErrors: Partial<Record<keyof AdMetaMappingInput, string>>;
      error?: string;
    };

const DUPLICATE_SOURCE_ID = "Bu source_id için zaten bir eşleme var.";
const NOT_FOUND = "Eşleme bulunamadı.";

/** Postgres unique_violation, possibly wrapped by the driver. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

type ParsedMapping =
  | { ok: true; value: AdMetaMappingInput }
  | {
      ok: false;
      fieldErrors: Partial<Record<keyof AdMetaMappingInput, string>>;
    };

function parseMapping(data: AdMetaMappingInput): ParsedMapping {
  const parsed = adMetaMappingSchema.safeParse(data);
  if (parsed.success) return { ok: true, value: parsed.data };
  const fieldErrors: Partial<Record<keyof AdMetaMappingInput, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof AdMetaMappingInput | undefined;
    if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  return { ok: false, fieldErrors };
}

export async function createAdMetaMapping(
  companyId: string,
  data: AdMetaMappingInput,
): Promise<AdMetaMappingResult> {
  await requireCompanyAccess(companyId);
  const parsed = parseMapping(data);
  if (!parsed.ok) return parsed;

  try {
    await db
      .insert(adMetaMappings)
      .values({ companyId, ...parsed.value })
      .returning({ id: adMetaMappings.id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, fieldErrors: { sourceId: DUPLICATE_SOURCE_ID } };
    }
    throw error;
  }

  revalidatePath(`/settings/companies/${companyId}`);
  return { ok: true };
}

export async function updateAdMetaMapping(
  companyId: string,
  mappingId: string,
  data: AdMetaMappingInput,
): Promise<AdMetaMappingResult> {
  await requireCompanyAccess(companyId);
  const parsed = parseMapping(data);
  if (!parsed.ok) return parsed;

  let updated: { id: string }[];
  try {
    updated = await db
      .update(adMetaMappings)
      .set({ ...parsed.value, updatedAt: new Date() })
      .where(
        and(
          eq(adMetaMappings.id, mappingId),
          eq(adMetaMappings.companyId, companyId),
        ),
      )
      .returning({ id: adMetaMappings.id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, fieldErrors: { sourceId: DUPLICATE_SOURCE_ID } };
    }
    throw error;
  }
  if (updated.length === 0) {
    return { ok: false, fieldErrors: {}, error: NOT_FOUND };
  }

  revalidatePath(`/settings/companies/${companyId}`);
  return { ok: true };
}

export async function deleteAdMetaMapping(
  companyId: string,
  mappingId: string,
): Promise<AdMetaMappingResult> {
  await requireCompanyAccess(companyId);

  const deleted = await db
    .delete(adMetaMappings)
    .where(
      and(
        eq(adMetaMappings.id, mappingId),
        eq(adMetaMappings.companyId, companyId),
      ),
    )
    .returning({ id: adMetaMappings.id });
  if (deleted.length === 0) {
    return { ok: false, fieldErrors: {}, error: NOT_FOUND };
  }

  revalidatePath(`/settings/companies/${companyId}`);
  return { ok: true };
}
