import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  agents,
  companies,
  effectiveIntake,
  workflowStages,
  workflows,
  type WorkflowIntakeField,
} from "@relay/db";
import { leadIntakeSchema, type LeadIntakeInput } from "@/lib/validators/lead-settings";

// Per-agent Lead capture (lead scoring spec, decision 8): the toggle that
// gives a customer agent the `record_lead` tool, and the workflow its leads
// feed, whose intake list is the agent's checklist. Callers authorize first
// with `requireAgentAccess` (customer agents are owner resources).

/** A workflow the agent's leads can feed. */
export type LeadCaptureWorkflowOption = {
  id: string;
  name: string;
  /** The workflow's inbound stage ("Enters at stage"); null when it has none. */
  stageName: string | null;
  /** Customer agents whose Lead capture feeds this workflow. */
  sharedBy: number;
};

/** Everything the Lead capture section shows for one customer agent. */
export type LeadCapturePanelData = {
  enabled: boolean;
  /** Null: no workflow picked, the legacy intake applies and cannot be edited here. */
  workflowId: string | null;
  intake: WorkflowIntakeField[];
  workflows: LeadCaptureWorkflowOption[];
  /** Company WhatsApp number told about qualified leads (null = off). */
  notifyWhatsapp: string | null;
};

export const leadCaptureSettingsSchema = z.object({
  enabled: z.boolean(),
  workflowId: z.uuid().nullable(),
});

export type LeadCaptureSettingsInput = z.infer<typeof leadCaptureSettingsSchema>;

export type LeadCaptureSettings = {
  enabled: boolean;
  workflowId: string | null;
  /** The checklist the agent works through (legacy list when no workflow). */
  intake: WorkflowIntakeField[];
};

export type UpdateLeadCaptureResult =
  | { ok: true; settings: LeadCaptureSettings }
  | { ok: false; error: "agent_not_found" | "not_customer_agent" | "workflow_not_found" };

async function loadIntake(
  companyId: string,
  workflowId: string | null,
): Promise<WorkflowIntakeField[] | null> {
  if (!workflowId) return effectiveIntake(null);
  const workflow = await db.query.workflows.findFirst({
    where: and(eq(workflows.id, workflowId), eq(workflows.companyId, companyId)),
  });
  return workflow ? effectiveIntake(workflow.intake) : null;
}

export async function getLeadCaptureSettings(
  agentId: string,
  companyId: string,
): Promise<LeadCaptureSettings | null> {
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.companyId, companyId)),
  });
  if (!agent || agent.kind !== "customer") return null;
  const intake = await loadIntake(companyId, agent.leadCaptureWorkflowId);
  return {
    enabled: agent.leadCaptureEnabled,
    workflowId: intake ? agent.leadCaptureWorkflowId : null,
    intake: intake ?? effectiveIntake(null),
  };
}

/**
 * Turn Lead capture on or off and pick its workflow. Only customer agents
 * have it, and the workflow must belong to the agent's company.
 */
export async function updateLeadCaptureSettings(
  agentId: string,
  companyId: string,
  input: LeadCaptureSettingsInput,
): Promise<UpdateLeadCaptureResult> {
  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.companyId, companyId)),
  });
  if (!agent) return { ok: false, error: "agent_not_found" };
  if (agent.kind !== "customer") return { ok: false, error: "not_customer_agent" };

  const intake = await loadIntake(companyId, input.workflowId);
  if (!intake) return { ok: false, error: "workflow_not_found" };

  await db
    .update(agents)
    .set({
      leadCaptureEnabled: input.enabled,
      leadCaptureWorkflowId: input.workflowId,
      updatedAt: new Date(),
    })
    .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)));

  return {
    ok: true,
    settings: { enabled: input.enabled, workflowId: input.workflowId, intake },
  };
}

export type UpdateLeadIntakeResult =
  | { ok: true; intake: WorkflowIntakeField[] }
  | {
      ok: false;
      error: "agent_not_found" | "not_customer_agent" | "no_workflow" | "workflow_not_found" | "invalid_intake";
    };

/**
 * Save the intake of the workflow the agent's Lead capture feeds (the editor
 * never names the workflow; it is read from the agent). The list is shared by
 * every customer agent feeding that workflow. Phone is never on it.
 */
export async function updateLeadIntake(
  agentId: string,
  companyId: string,
  input: LeadIntakeInput,
): Promise<UpdateLeadIntakeResult> {
  const parsed = leadIntakeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_intake" };

  const agent = await db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), eq(agents.companyId, companyId)),
  });
  if (!agent) return { ok: false, error: "agent_not_found" };
  if (agent.kind !== "customer") return { ok: false, error: "not_customer_agent" };
  const workflowId = agent.leadCaptureWorkflowId;
  if (!workflowId) return { ok: false, error: "no_workflow" };

  const workflow = await db.query.workflows.findFirst({
    where: and(eq(workflows.id, workflowId), eq(workflows.companyId, companyId)),
  });
  if (!workflow) return { ok: false, error: "workflow_not_found" };

  const intake = parsed.data.map((f) => ({ key: f.key, label: f.label, required: f.required }));
  await db
    .update(workflows)
    .set({ intake })
    .where(and(eq(workflows.id, workflowId), eq(workflows.companyId, companyId)));
  return { ok: true, intake };
}

/**
 * The customer inspector's Lead capture section: the agent's settings, the
 * company's workflows (with their inbound stage and how many customer agents
 * feed each) and the qualified-lead WhatsApp number. Null for operator agents.
 */
export async function loadLeadCapturePanel(
  agentId: string,
  companyId: string,
): Promise<LeadCapturePanelData | null> {
  const [settings, workflowRows, feeders, company] = await Promise.all([
    getLeadCaptureSettings(agentId, companyId),
    db
      .select({ id: workflows.id, name: workflows.name, inboundStageId: workflows.inboundStageId })
      .from(workflows)
      .where(eq(workflows.companyId, companyId))
      .orderBy(asc(workflows.position), asc(workflows.createdAt)),
    db
      .select({ workflowId: agents.leadCaptureWorkflowId })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.kind, "customer"))),
    db
      .select({ leadNotifyWhatsapp: companies.leadNotifyWhatsapp })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1),
  ]);
  if (!settings) return null;

  const stageIds = workflowRows.flatMap((w) => (w.inboundStageId ? [w.inboundStageId] : []));
  const stages =
    stageIds.length === 0
      ? []
      : await db
          .select({ id: workflowStages.id, name: workflowStages.name })
          .from(workflowStages)
          .where(inArray(workflowStages.id, stageIds));
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const sharedBy = new Map<string, number>();
  for (const f of feeders) {
    if (f.workflowId) sharedBy.set(f.workflowId, (sharedBy.get(f.workflowId) ?? 0) + 1);
  }

  return {
    enabled: settings.enabled,
    workflowId: settings.workflowId,
    intake: settings.intake,
    workflows: workflowRows.map((w) => ({
      id: w.id,
      name: w.name,
      stageName: w.inboundStageId ? (stageName.get(w.inboundStageId) ?? null) : null,
      sharedBy: sharedBy.get(w.id) ?? 0,
    })),
    notifyWhatsapp: company[0]?.leadNotifyWhatsapp ?? null,
  };
}
