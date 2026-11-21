import { and, eq } from "drizzle-orm";
import { db, effectiveIntake, workflows } from "@relay/db";
import type { LeadCaptureContext } from "../ai/record-lead-tool";

/** The agent fields Lead capture reads, as loaded by every customer runtime. */
export interface LeadCaptureAgent {
  id: string;
  companyId: string;
  kind: string;
  leadCaptureEnabled: boolean;
  leadCaptureWorkflowId: string | null;
}

/**
 * The `record_lead` binding for one customer agent turn, or undefined when the
 * agent's Lead capture toggle is off (lead scoring spec, decision 8). The
 * intake is the picked workflow's list; with no workflow, or a workflow of
 * another company, the legacy checklist (`effectiveIntake`).
 */
export async function loadLeadCapture(
  agent: LeadCaptureAgent,
  getChatId: () => string | null,
): Promise<LeadCaptureContext | undefined> {
  if (agent.kind !== "customer" || !agent.leadCaptureEnabled) return undefined;

  const workflow = agent.leadCaptureWorkflowId
    ? await db.query.workflows.findFirst({
        where: and(
          eq(workflows.id, agent.leadCaptureWorkflowId),
          eq(workflows.companyId, agent.companyId),
        ),
      })
    : undefined;

  return {
    agentId: agent.id,
    companyId: agent.companyId,
    getChatId,
    intake: effectiveIntake(workflow?.intake),
    // No workflow means no Qualify agent: score on a complete checklist (W3GAP).
    scoreOnComplete: !agent.leadCaptureWorkflowId,
  };
}
