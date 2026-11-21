"use server";

import { revalidatePath } from "next/cache";
import { installPackageForCompany } from "@/lib/packages";
import { PackageInstallError } from "@/lib/operator/package-errors";
import { installPackageSchema, type InstallPackageInput } from "@/lib/validators/operator";

export type InstallPackageResult = { ok: true; waiting: boolean } | { error: string };

/**
 * Settings › Packages install (spec 2026-10-02-packages, decisions 4-6). Owner-only: agent-ops
 * checks ownership and runs the one-transaction install. Errors come back as values so their
 * text survives production server-action error masking.
 */
export async function installCompanyPackage(data: InstallPackageInput): Promise<InstallPackageResult> {
  const parsed = installPackageSchema.safeParse(data);
  if (!parsed.success) return { error: "Invalid package" };
  try {
    const result = await installPackageForCompany(parsed.data.companyId, parsed.data.slug);
    revalidatePath("/settings/packages");
    revalidatePath("/operator");
    return { ok: true, waiting: result.waitingFor.length > 0 };
  } catch (error) {
    if (error instanceof PackageInstallError) return { error: error.message };
    throw error;
  }
}
