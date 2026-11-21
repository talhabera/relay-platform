import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { requireCompanyAccess } from "@/lib/authorization";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/v2/primitives";
import { CompanySettingsForm } from "@/components/company/company-settings-form";
import { CompanyRateLimitsForm } from "@/components/company/company-rate-limits-form";
import { CompanyAdSettingsForm } from "@/components/company/company-ad-settings-form";
import { CompanyAdMetaMappings } from "@/components/company/company-ad-meta-mappings";
import { CompanyOfflineConversionsCard } from "@/components/company/company-offline-conversions-card";
import { buildRateLimitSettings } from "@/lib/company/rate-limit-settings";
import { db } from "@/db";
import { adMetaMappings } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

import { SettingsHeader } from "../../settings-header";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { company } = await requireCompanyAccess(id);
  if (!company) {
    notFound();
  }

  const rateLimitGroups = buildRateLimitSettings(company.rateLimits);

  const metaMappings = await db
    .select({
      id: adMetaMappings.id,
      sourceId: adMetaMappings.sourceId,
      code: adMetaMappings.code,
      campaignName: adMetaMappings.campaignName,
    })
    .from(adMetaMappings)
    .where(eq(adMetaMappings.companyId, company.id))
    .orderBy(asc(adMetaMappings.campaignName), asc(adMetaMappings.sourceId));

  return (
    <div className="space-y-6">
      <SettingsHeader
        title={company.name}
        description="Company details and rate limits. The website widget is configured on its customer agent in Agents. Members and connectors follow the active company."
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/settings/companies">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Companies
            </Link>
          </Button>
        }
      />

      <SegmentedTabs
        aria-label="Company sections"
        defaultValue="settings"
        contentClassName="mt-6"
        items={[
          {
            value: "settings",
            label: "General Settings",
            content: (
              <CompanySettingsForm company={company} />
            ),
          },
          {
            value: "rate-limits",
            label: "Rate limits",
            content: (
              <CompanyRateLimitsForm
                companyId={company.id}
                groups={rateLimitGroups}
              />
            ),
          },
          {
            value: "ads",
            label: "Ads",
            content: (
              <div className="space-y-6">
                <CompanyAdSettingsForm
                  companyId={company.id}
                  initial={{
                    adMonthlyTargetMinor: company.adMonthlyTargetMinor,
                    adCplStopMinor: company.adCplStopMinor,
                    adDailyCapMinor: company.adDailyCapMinor,
                    adCapacitySiteMonthly: company.adCapacitySiteMonthly,
                    adCapacitySocialMonthly: company.adCapacitySocialMonthly,
                  }}
                />
                <CompanyAdMetaMappings
                  companyId={company.id}
                  mappings={metaMappings}
                />
              </div>
            ),
          },
          {
            value: "offline-conversions",
            label: "Offline conversions",
            content: (
              <CompanyOfflineConversionsCard
                companyId={company.id}
                timeZone={company.timezone}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
