import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { workflows, workflowStages } from "./workflows";

const fkOn = (
  config: ReturnType<typeof getTableConfig>,
  column: string,
) =>
  config.foreignKeys.find((fk) =>
    fk.reference().columns.some((c) => c.name === column),
  );

describe("workflows table", () => {
  const config = getTableConfig(workflows);

  it("carries the tenant and cascades with the company", () => {
    expect(config.columns.find((c) => c.name === "company_id")?.notNull).toBe(
      true,
    );
    expect(fkOn(config, "company_id")?.onDelete).toBe("cascade");
  });

  it("keeps target and inbound stage optional", () => {
    for (const name of ["weekly_target", "target_metric_key", "inbound_stage_id"]) {
      expect(config.columns.find((c) => c.name === name)?.notNull).toBe(false);
    }
  });

  it("clears the inbound stage when that stage is deleted", () => {
    const fk = fkOn(config, "inbound_stage_id");
    expect(fk?.reference().foreignTable).toBe(workflowStages);
    expect(fk?.onDelete).toBe("set null");
  });

  it("bounds the weekly target at the database", () => {
    expect(config.checks.map((c) => c.name)).toContain(
      "workflows_weekly_target_chk",
    );
  });
});

describe("workflow_stages table", () => {
  const config = getTableConfig(workflowStages);

  it("holds one stage per order within a workflow", () => {
    const index = config.indexes.find(
      (i) => i.config.name === "workflow_stages_workflow_id_order_uidx",
    );
    expect(index?.config.unique).toBe(true);
    expect(
      index?.config.columns.map((c) => ("name" in c ? c.name : "")),
    ).toEqual(["workflow_id", "order"]);
  });

  it("goes with its workflow", () => {
    expect(fkOn(config, "workflow_id")?.onDelete).toBe("cascade");
  });

  it("keeps rendering as No agent when its agent is deleted", () => {
    expect(config.columns.find((c) => c.name === "agent_id")?.notNull).toBe(
      false,
    );
    expect(fkOn(config, "agent_id")?.onDelete).toBe("set null");
  });
});
