import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeBase, userPreferences } from "@/db/schema";
import { requireSession } from "@/lib/auth-server";
import { isCompanyOwner } from "@/lib/operator/access";
import {
  listAccessibleCompanies,
  resolveActiveCompanyId,
} from "@/lib/operator/companies";
import { loadLeadCapturePanel } from "@/lib/leads/lead-capture";
import { resolvePagePermissions } from "@/lib/page-access";
import { PageHeader } from "@/components/shared/page-header";
import { NoCompanyState, PageRestricted, SystemStateFrame } from "@/components/v2/shell";
import { CreateAgentDialog } from "@/components/agent/create-agent-dialog";
import { AgentsEmpty } from "./_canvas/agents-empty";
import { AgentsKindNav } from "./_canvas/agents-kind-nav";
import { AgentsWorkspace } from "./_canvas/agents-workspace";
import { loadAgentsCanvas, loadAgentsWidget } from "./_canvas/load-agents-canvas";
import { maskWhatsapp } from "./_canvas/handoff/handoff-model";
import { loadHandoffPanel } from "./_canvas/handoff/load-handoff";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[]; panel?: string | string[] }>;
}) {
  const session = await requireSession();

  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, session.user.id))
    .limit(1);

  const accessibleCompanies = await listAccessibleCompanies(session.user.id);
  const activeCompanyId = resolveActiveCompanyId(
    prefs?.activeCompanyId,
    accessibleCompanies,
  );
  const isOwner = accessibleCompanies.some(
    (company) => company.ownerId === session.user.id,
  );

  if (!activeCompanyId) {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={isOwner} />
      </SystemStateFrame>
    );
  }

  const activeCompany = accessibleCompanies.find(
    (company) => company.id === activeCompanyId,
  );
  if (!activeCompany) {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={isOwner} />
      </SystemStateFrame>
    );
  }

  const permissions = await resolvePagePermissions(
    session.user.id,
    activeCompany,
  );
  if (!permissions.agents) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Customer agents"
          description="Customer agents for widget and messaging channels."
        />
        <div className="flex justify-center">
          <PageRestricted
            title="Customer agents isn't available"
            description="Ask an owner to grant you Customer agents access for this company."
          />
        </div>
      </div>
    );
  }

  const canManageAgents = isCompanyOwner(session.user.id, activeCompany);
  const { agent: selectedParam, panel } = await searchParams;
  const [model, widget] = await Promise.all([
    loadAgentsCanvas(
      activeCompanyId,
      typeof selectedParam === "string" ? selectedParam : undefined,
    ),
    canManageAgents ? loadAgentsWidget(activeCompanyId) : Promise.resolve(null),
  ]);
  const [leadCapture, knowledge, handoffPanel] = model.selected
    ? await Promise.all([
        loadLeadCapturePanel(model.selected.agentId, activeCompanyId),
        db
          .select()
          .from(knowledgeBase)
          .where(eq(knowledgeBase.agentId, model.selected.agentId))
          .orderBy(desc(knowledgeBase.createdAt)),
        loadHandoffPanel({ id: model.selected.agentId, companyId: activeCompanyId }),
      ])
    : [null, [], null];
  // Members see the handoff read-only; the recipient's number stays masked for them.
  const handoff =
    handoffPanel && !canManageAgents && handoffPanel.settings.recipientWhatsapp
      ? {
          ...handoffPanel,
          settings: {
            ...handoffPanel.settings,
            recipientWhatsapp: maskWhatsapp(handoffPanel.settings.recipientWhatsapp),
          },
        }
      : handoffPanel;

  return (
    <div className="flex flex-col gap-4 pt-4">
      <h1 className="sr-only">Customer agents</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AgentsKindNav active="customer" />
        {canManageAgents ? <CreateAgentDialog companyId={activeCompanyId} /> : null}
      </div>

      <AgentsWorkspace
        model={model}
        companyId={activeCompanyId}
        widget={widget}
        canManage={canManageAgents}
        leadCapture={leadCapture}
        knowledge={knowledge}
        handoff={handoff}
        panel={panel === "handoff" ? "handoff" : undefined}
        empty={
          <AgentsEmpty
            companyName={activeCompany.name}
            action={canManageAgents ? <CreateAgentDialog companyId={activeCompanyId} /> : undefined}
          />
        }
      />
    </div>
  );
}
