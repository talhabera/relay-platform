import { db } from "@/db";
import { agents, workflows, workflowStages } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { IntakeField, WorkflowFlow } from "@/lib/fixtures/interfaces";
import { isMetricKey, type MetricKey } from "./metrics";

// Web-side workflow writer. Phase 1 has no create or edit UI (decision 2).
// Package install does not use it: agent-ops `insertPackageRows`
// (packages/agent-ops/src/operator/packages.ts) inserts workflows and stages
// in its own transaction.

export type WorkflowStageDefinition = {
  order: number;
  name: string;
  /** Null for an outcome stage such as Delivered to client. */
  agentId: string | null;
  metricKey: MetricKey;
};

export type WorkflowDefinition = {
  packageSlug: string;
  name: string;
  flow: WorkflowFlow;
  position?: number;
  weeklyTarget?: number | null;
  targetMetricKey?: MetricKey | null;
  /** `order` of the stage customer-agent leads enter through. */
  inboundStageOrder?: number | null;
  intake?: IntakeField[];
  stages: WorkflowStageDefinition[];
};

export class WorkflowDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowDefinitionError";
  }
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type WorkflowExecutor = typeof db | Transaction;

/** Shape checks that need no database. Throws `WorkflowDefinitionError`. */
export function validateWorkflowDefinition(def: WorkflowDefinition): void {
  if (def.stages.length === 0) {
    throw new WorkflowDefinitionError("A workflow needs at least one stage");
  }
  const orders = new Set<number>();
  for (const s of def.stages) {
    if (orders.has(s.order)) {
      throw new WorkflowDefinitionError(`Duplicate stage order ${s.order}`);
    }
    orders.add(s.order);
    if (!isMetricKey(s.metricKey)) {
      throw new WorkflowDefinitionError(`Unknown metric key "${s.metricKey}"`);
    }
  }
  const target = def.weeklyTarget ?? null;
  const targetKey = def.targetMetricKey ?? null;
  if ((target === null) !== (targetKey === null)) {
    throw new WorkflowDefinitionError(
      "Weekly target and target metric key are set together",
    );
  }
  if (target !== null && (!Number.isInteger(target) || target < 0)) {
    throw new WorkflowDefinitionError("Weekly target must be a whole number >= 0");
  }
  if (targetKey !== null && !isMetricKey(targetKey)) {
    throw new WorkflowDefinitionError(`Unknown metric key "${targetKey}"`);
  }
  const inbound = def.inboundStageOrder ?? null;
  if (inbound !== null && !orders.has(inbound)) {
    throw new WorkflowDefinitionError(`No stage with order ${inbound} for inbound`);
  }
}

/**
 * Inserts a workflow and its stages for a company. Stage agents must be
 * operator agents of the same company (decision 4: checked on write, not by
 * the schema). Pass the install transaction as `executor`.
 */
export async function insertWorkflow(
  executor: WorkflowExecutor,
  companyId: string,
  def: WorkflowDefinition,
): Promise<{ workflowId: string; stageIds: Map<number, string> }> {
  validateWorkflowDefinition(def);

  const agentIds = [
    ...new Set(
      def.stages.map((s) => s.agentId).filter((id): id is string => id !== null),
    ),
  ];
  if (agentIds.length > 0) {
    const found = await executor.query.agents.findMany({
      columns: { id: true, kind: true },
      where: and(eq(agents.companyId, companyId), inArray(agents.id, agentIds)),
    });
    const kindOf = new Map(found.map((a) => [a.id, a.kind]));
    for (const id of agentIds) {
      const kind = kindOf.get(id);
      if (!kind) {
        throw new WorkflowDefinitionError(`Agent ${id} is not in this company`);
      }
      if (kind !== "operator") {
        throw new WorkflowDefinitionError(
          `Agent ${id} is a customer agent; customer agents are never stages`,
        );
      }
    }
  }

  const [workflow] = await executor
    .insert(workflows)
    .values({
      companyId,
      packageSlug: def.packageSlug,
      name: def.name,
      flow: def.flow,
      position: def.position ?? 0,
      weeklyTarget: def.weeklyTarget ?? null,
      targetMetricKey: def.targetMetricKey ?? null,
      intake: def.intake ?? [],
    })
    .returning({ id: workflows.id });

  const stages = await executor
    .insert(workflowStages)
    .values(
      def.stages.map((s) => ({
        workflowId: workflow.id,
        order: s.order,
        name: s.name,
        agentId: s.agentId,
        metricKey: s.metricKey,
      })),
    )
    .returning({ id: workflowStages.id, order: workflowStages.order });

  const stageIds = new Map(stages.map((s) => [s.order, s.id]));
  const inbound = def.inboundStageOrder ?? null;
  if (inbound !== null) {
    await executor
      .update(workflows)
      .set({ inboundStageId: stageIds.get(inbound) })
      .where(eq(workflows.id, workflow.id));
  }
  return { workflowId: workflow.id, stageIds };
}
