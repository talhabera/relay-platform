"use server";

import { revalidatePath } from "next/cache";
import { installPackageForCompany } from "@/lib/packages/install";
import {
  installPackageSchema,
  type InstallPackageInput,
} from "@/lib/validators/operator";

/**
 * Owner-only package install (packages spec, decision 5). Creates the
 * package's agents, workflows and Schedules in one transaction; `id` is the
 * first agent, for callers that open it after install.
 */
export async function installPackage(data: InstallPackageInput) {
  const parsed = installPackageSchema.parse(data);
  const result = await installPackageForCompany(parsed.companyId, parsed.slug);

  revalidatePath("/operator");
  revalidatePath("/settings/packages");

  return { id: result.agentIds[0], ...result };
}
