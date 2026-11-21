import { eq } from "drizzle-orm";

import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { requireSession } from "@/lib/auth-server";
import { listAccessibleCompanies, resolveActiveCompanyId } from "@/lib/operator/companies";
import { resolvePagePermissions } from "@/lib/page-access";
import { CreateOperatorAgentDialog } from "@/components/operator/create-operator-agent-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { NoCompanyState, PageRestricted, SystemStateFrame } from "@/components/v2/shell";
import { Icon } from "@/components/v2/primitives";

import { AgentsKindNav } from "../_canvas/agents-kind-nav";
import { loadOperatorCanvas } from "./_canvas/load-operator-canvas";
import { loadOperatorInspector } from "./_canvas/load-operator-inspector";
import { OperatorCanvas } from "./_canvas/operator-canvas";
import { OperatorInspector } from "./_canvas/operator-inspector";

const param = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

/**
 * Operator agents canvas (Figma 07 `agents-operator/default`): operator agents and the
 * connectors they act through, with the selected agent's inspector. Replaces the
 * `/operator/agents/[id]` settings page (which redirects here). Gated by the Operator page
 * permission, like the operator hub.
 */
export default async function OperatorAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[]; version?: string | string[] }>;
}) {
  const session = await requireSession();

  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, session.user.id))
    .limit(1);

  const accessibleCompanies = await listAccessibleCompanies(session.user.id);
  const activeCompanyId = resolveActiveCompanyId(prefs?.activeCompanyId, accessibleCompanies);
  const isOwner = accessibleCompanies.some((company) => company.ownerId === session.user.id);
  const activeCompany = accessibleCompanies.find((company) => company.id === activeCompanyId);

  if (!activeCompanyId || !activeCompany) {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={isOwner} />
      </SystemStateFrame>
    );
  }

  const permissions = await resolvePagePermissions(session.user.id, activeCompany);
  if (!permissions.operator) {
    return (
      <div className="space-y-6">
        <PageHeader title="Operator agents" description="Internal agents and the connectors they act through." />
        <div className="flex justify-center">
          <PageRestricted
            title="Operator agents isn't available"
            description="Ask an owner to grant you Operator access for this company."
          />
        </div>
      </div>
    );
  }

  const query = await searchParams;
  const model = await loadOperatorCanvas(activeCompanyId, param(query.agent), param(query.version));
  const inspector = model.selected ? await loadOperatorInspector(model.selected.agentId) : null;

  return (
    <div className="flex flex-col gap-4 pt-4">
      <h1 className="sr-only">Operator agents</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AgentsKindNav active="operator" />
        <CreateOperatorAgentDialog companyId={activeCompanyId} />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <div className="min-w-0 flex-1">
          <OperatorCanvas
            model={model}
            empty={
              <div
                data-slot="operator-agents-empty"
                className="flex min-h-[320px] w-[330px] max-w-full flex-col items-center justify-center gap-3 px-6 text-center lg:min-h-[700px]"
              >
                <span className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                  <Icon name="bot" size={20} />
                </span>
                <h2 className="type-h3 text-foreground">No operator agents yet</h2>
                <p className="type-small text-muted-foreground">
                  Create an operator agent for {activeCompany.name} to work through its connectors.
                </p>
              </div>
            }
          />
        </div>
        {model.selected ? (
          <OperatorInspector
            key={`${model.selected.agentId}:${model.selected.focusVersion?.id ?? ""}`}
            selection={model.selected}
            data={inspector}
          />
        ) : null}
      </div>
    </div>
  );
}
