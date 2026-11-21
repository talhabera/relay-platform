import {
  installPackage,
  type PackageInstallResult,
} from "@relay/agent-ops/operator/packages";
import { requireSession } from "@/lib/auth-server";

/**
 * Owner-only install for the signed-in user (decision 5). The owner check,
 * the transaction and the "Waiting for connectors" pause live in agent-ops.
 */
export async function installPackageForCompany(
  companyId: string,
  slug: string,
): Promise<PackageInstallResult> {
  const session = await requireSession();
  return installPackage(session.user.id, companyId, slug);
}
