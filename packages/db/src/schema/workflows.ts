import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { agents } from "./agents";

// Workflow and stage model (spec 2026-10-02-workflow-stage-model).
// A workflow is a display grouping of operator agents into ordered stages,
// installed by a package. It never triggers or schedules anything.

export const WORKFLOW_FLOWS = ["sequence", "parallel"] as const;
export type WorkflowFlow = (typeof WORKFLOW_FLOWS)[number];

/** One field a customer agent collects before it records an inbound lead. */
export type WorkflowIntakeField = {
  key: string;
  label: string;
  required: boolean;
};

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Package that installed it; phase 1 has no other source. */
    packageSlug: text("package_slug").notNull(),
    name: text("name").notNull(),
    /** `sequence` draws edges between consecutive stages; `parallel` draws none. */
    flow: text("flow", { enum: WORKFLOW_FLOWS }).notNull().default("sequence"),
    weeklyTarget: integer("weekly_target"),
    /** Metric key (code catalog) the weekly target counts. */
    targetMetricKey: text("target_metric_key"),
    /** Stage customer-agent leads enter through; never a customer agent stage. */
    inboundStageId: uuid("inbound_stage_id").references(
      (): AnyPgColumn => workflowStages.id,
      { onDelete: "set null" },
    ),
    intake: jsonb("intake")
      .$type<WorkflowIntakeField[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("workflows_company_id_position_idx").on(
      table.companyId,
      table.position,
    ),
    check(
      "workflows_weekly_target_chk",
      sql`weekly_target IS NULL OR weekly_target >= 0`,
    ),
  ],
);

export const workflowStages = pgTable(
  "workflow_stages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    name: text("name").notNull(),
    /**
     * Operator agent running the stage. Null is an outcome stage, or a stage
     * whose agent was deleted ("No agent"). Operator-only is checked on write.
     */
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    /** Key into the code metric catalog, e.g. `records.gathered`. */
    metricKey: text("metric_key").notNull(),
  },
  (table) => [
    uniqueIndex("workflow_stages_workflow_id_order_uidx").on(
      table.workflowId,
      table.order,
    ),
    index("workflow_stages_agent_id_idx").on(table.agentId),
  ],
);
