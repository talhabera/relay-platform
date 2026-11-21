import { Building2 } from "lucide-react";
import { requireSession } from "@/lib/auth-server";
import { EmptyState } from "@/components/shared/empty-state";

import { resolveSettingsCompany } from "../active-company";
import { SettingsHeader } from "../settings-header";
import { CompaniesList } from "./companies-list";
import { loadAgentCounts } from "./companies-data";
import { agentCountsLabel, companyRowDescription, type CompanyListItem } from "./company-view";
import { NewCompanyDialog } from "./new-company-dialog";
import { listAccessibleCompanies } from "@/lib/operator/companies";

/** Figma 08c `companies`: companies the user owns or belongs to, with Switch and owner actions. */
export default async function CompaniesPage() {
  const session = await requireSession();
  const userId = session.user.id;

  const [accessible, { company: active }] = await Promise.all([
    listAccessibleCompanies(userId),
    resolveSettingsCompany(userId),
  ]);
  const counts = await loadAgentCounts(accessible.map((c) => c.id));

  const items: CompanyListItem[] = accessible.map((company) => ({
    id: company.id,
    name: company.name,
    description: companyRowDescription(company),
    role: company.ownerId === userId ? "Owner" : "Member",
    current: company.id === active?.id,
    meta: agentCountsLabel(counts.get(company.id) ?? { customer: 0, operator: 0 }),
  }));

  return (
    <div>
      <SettingsHeader
        title="Companies"
        description="Companies you own or belong to. Switching company changes which agents, inbox and analytics you see."
        action={<NewCompanyDialog />}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No companies yet"
          description="Create your first company to start building AI agents for your clients."
        />
      ) : (
        <CompaniesList companies={items} />
      )}
    </div>
  );
}
