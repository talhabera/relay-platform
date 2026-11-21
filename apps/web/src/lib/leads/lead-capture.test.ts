import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { LEGACY_INBOUND_INTAKE } from "@relay/db";
import {
  getLeadCaptureSettings,
  leadCaptureSettingsSchema,
  updateLeadCaptureSettings,
  updateLeadIntake,
} from "./lead-capture";

const agentFind = vi.fn();
const workflowFind = vi.fn();
const set = vi.fn();
const where = vi.fn();

const WORKFLOW_ID = "5b1f9a64-1c3e-4d2a-9f0b-2a6c8e4d1f37";
const CUSTOMER = {
  id: "agent-1",
  companyId: "co-1",
  kind: "customer",
  leadCaptureEnabled: true,
  leadCaptureWorkflowId: null,
};
const INTAKE = [{ key: "need", label: "Need", required: true }];

beforeEach(() => {
  vi.clearAllMocks();
  agentFind.mockResolvedValue(CUSTOMER);
  workflowFind.mockResolvedValue({ id: WORKFLOW_ID, intake: INTAKE });
  where.mockResolvedValue(undefined);
  set.mockReturnValue({ where });
  const query = db.query as unknown as Record<string, unknown>;
  query.agents = { findFirst: agentFind };
  query.workflows = { findFirst: workflowFind };
  (db as unknown as { update: unknown }).update = vi.fn(() => ({ set }));
});

describe("lead capture settings", () => {
  it("reads the legacy checklist while no workflow is picked", async () => {
    await expect(getLeadCaptureSettings("agent-1", "co-1")).resolves.toEqual({
      enabled: true,
      workflowId: null,
      intake: LEGACY_INBOUND_INTAKE,
    });
  });

  it("has no settings for an operator agent", async () => {
    agentFind.mockResolvedValue({ ...CUSTOMER, kind: "operator" });
    await expect(getLeadCaptureSettings("agent-1", "co-1")).resolves.toBeNull();
  });

  it("turns lead capture on with a workflow of the same company", async () => {
    const result = await updateLeadCaptureSettings("agent-1", "co-1", {
      enabled: true,
      workflowId: WORKFLOW_ID,
    });

    expect(result).toEqual({
      ok: true,
      settings: { enabled: true, workflowId: WORKFLOW_ID, intake: INTAKE },
    });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ leadCaptureEnabled: true, leadCaptureWorkflowId: WORKFLOW_ID }),
    );
  });

  it("refuses a workflow the company does not have", async () => {
    workflowFind.mockResolvedValue(undefined);
    const result = await updateLeadCaptureSettings("agent-1", "co-1", {
      enabled: true,
      workflowId: WORKFLOW_ID,
    });

    expect(result).toEqual({ ok: false, error: "workflow_not_found" });
    expect(set).not.toHaveBeenCalled();
  });

  it("refuses an operator agent", async () => {
    agentFind.mockResolvedValue({ ...CUSTOMER, kind: "operator" });
    const result = await updateLeadCaptureSettings("agent-1", "co-1", {
      enabled: false,
      workflowId: null,
    });

    expect(result).toEqual({ ok: false, error: "not_customer_agent" });
  });

  it("validates the input shape", () => {
    expect(leadCaptureSettingsSchema.safeParse({ enabled: true, workflowId: "x" }).success).toBe(false);
    expect(leadCaptureSettingsSchema.safeParse({ enabled: false, workflowId: null }).success).toBe(true);
  });
});

describe("lead intake", () => {
  const FIELDS = [
    { key: "name", label: "Name", required: true },
    { key: "need", label: "Need", required: false },
  ];

  it("saves the intake of the agent's own workflow", async () => {
    agentFind.mockResolvedValue({ ...CUSTOMER, leadCaptureWorkflowId: WORKFLOW_ID });
    const result = await updateLeadIntake("agent-1", "co-1", FIELDS);
    expect(result).toEqual({ ok: true, intake: FIELDS });
    expect(set).toHaveBeenCalledWith({ intake: FIELDS });
  });

  it("refuses when the agent feeds no workflow", async () => {
    const result = await updateLeadIntake("agent-1", "co-1", FIELDS);
    expect(result).toEqual({ ok: false, error: "no_workflow" });
    expect(set).not.toHaveBeenCalled();
  });

  it("refuses a workflow outside the company", async () => {
    agentFind.mockResolvedValue({ ...CUSTOMER, leadCaptureWorkflowId: WORKFLOW_ID });
    workflowFind.mockResolvedValue(undefined);
    await expect(updateLeadIntake("agent-1", "co-1", FIELDS)).resolves.toEqual({
      ok: false,
      error: "workflow_not_found",
    });
  });

  it("refuses an operator agent", async () => {
    agentFind.mockResolvedValue({ ...CUSTOMER, kind: "operator", leadCaptureWorkflowId: WORKFLOW_ID });
    await expect(updateLeadIntake("agent-1", "co-1", FIELDS)).resolves.toEqual({
      ok: false,
      error: "not_customer_agent",
    });
  });

  it("refuses a phone field, a bad key or a duplicate", async () => {
    agentFind.mockResolvedValue({ ...CUSTOMER, leadCaptureWorkflowId: WORKFLOW_ID });
    for (const bad of [
      [{ key: "phone", label: "Phone", required: true }],
      [{ key: "Bad Key", label: "X", required: true }],
      [...FIELDS, FIELDS[0]],
      [],
    ]) {
      await expect(updateLeadIntake("agent-1", "co-1", bad)).resolves.toEqual({ ok: false, error: "invalid_intake" });
    }
    expect(set).not.toHaveBeenCalled();
  });
});
