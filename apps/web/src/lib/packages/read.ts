import {
  connectedConnectorTypes,
  listPackageInstalls,
} from "@relay/agent-ops/operator/packages";
import { buildPackageCards, type PackageCardView } from "./view";

/**
 * Packages page data for a company. The caller has checked membership;
 * `isOwner` decides whether Install shows (decision 5).
 */
export async function getPackageCards(
  companyId: string,
  isOwner: boolean,
): Promise<PackageCardView[]> {
  const [installs, connectedTypes] = await Promise.all([
    listPackageInstalls(companyId),
    connectedConnectorTypes(companyId),
  ]);
  return buildPackageCards({ installs, connectedTypes, isOwner });
}
