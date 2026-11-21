import { requireSession } from "@/lib/auth-server";
import { requireCompanyMembership } from "@/lib/operator/access";
import { getPackageCards } from "@/lib/packages";
import { NoCompanyState } from "@/components/v2/shell";

import { resolveSettingsCompany } from "../active-company";
import { SettingsHeader } from "../settings-header";
import { packageCardModels } from "./package-view";
import { PackagesGrid } from "./packages-grid";

/**
 * Figma 08c `packages*`: the active company's packages. Owners install; members see the page
 * read-only (spec 2026-10-02-packages, decision 5).
 */
export default async function SettingsPackagesPage() {
  const session = await requireSession();
  const { company, isOwner, ownsAny } = await resolveSettingsCompany(session.user.id);

  if (!company) {
    return <NoCompanyState isOwner={ownsAny} />;
  }
  await requireCompanyMembership(company.id);

  const views = await getPackageCards(company.id, isOwner);
  // Card metric values have no source yet: the live line shows only once numbers exist.
  const models = packageCardModels(views, {
    companyName: company.name,
    timezone: company.timezone || "UTC",
    isOwner,
    metrics: {},
  });

  return (
    <div>
      <SettingsHeader
        title="Packages"
        description={`Ready-made sets of operator agents, workflows and schedules for ${company.name}. Installing a package adds them to Operator.`}
      />
      <PackagesGrid companyId={company.id} models={models} />
    </div>
  );
}
