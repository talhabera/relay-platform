import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workflows } from "@/db/schema";
import { requireCompanyAccess } from "@relay/agent-ops/auth/access";
import { isMetricKey } from "@/lib/workflows/metrics";

// Inline weekly-target edit on the Goal strip (workflow spec decision 7):
// owners only, members see the number read-only. Owner-only is the customer
// resource helper (`requireCompanyAccess`), not the membership one.

export const MAX_WEEKLY_TARGET = 10_000;

export const weeklyTargetSchema = z.object({
  workflowId: z.string().uuid(),
  weeklyTarget: z.number().int().min(0).max(MAX_WEEKLY_TARGET),
});

export type WeeklyTargetInput = z.infer<typeof weeklyTargetSchema>;

export class WeeklyTargetError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "no_target_metric",
  ) {
    super(message);
    this.name = "WeeklyTargetError";
  }
}

/**
 * Sets a workflow's weekly target. The company comes from the stored
 * workflow, never from the caller. Throws for a non-owner, an unknown
 * workflow, or a workflow with no target metric to count.
 */
export async function setWeeklyTarget(
  userId: string,
  input: WeeklyTargetInput,
): Promise<{ workflowId: string; companyId: string; weeklyTarget: number }> {
  const parsed = weeklyTargetSchema.parse(input);
  const workflow = await db.query.workflows.findFirst({
    columns: { id: true, companyId: true, targetMetricKey: true },
    where: eq(workflows.id, parsed.workflowId),
  });
  if (!workflow) {
    throw new WeeklyTargetError("Workflow not found", "not_found");
  }
  await requireCompanyAccess(userId, workflow.companyId);
  if (!isMetricKey(workflow.targetMetricKey)) {
    throw new WeeklyTargetError(
      "This workflow has no target metric",
      "no_target_metric",
    );
  }
  await db
    .update(workflows)
    .set({ weeklyTarget: parsed.weeklyTarget })
    .where(eq(workflows.id, workflow.id));
  return {
    workflowId: workflow.id,
    companyId: workflow.companyId,
    weeklyTarget: parsed.weeklyTarget,
  };
}
