import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordLead, notifyQualifiedLead, scoreLead, recordFirstResponse } = vi.hoisted(() => ({
  recordLead: vi.fn(),
  notifyQualifiedLead: vi.fn(),
  scoreLead: vi.fn(),
  recordFirstResponse: vi.fn(),
}));
vi.mock("../leads/first-response", () => ({
  recordFirstResponse: (...args: unknown[]) => recordFirstResponse(...args),
}));
vi.mock("../leads/score-lead", () => ({
  scoreLead: (...args: unknown[]) => scoreLead(...args),
}));

vi.mock("../leads/record-lead", () => ({
  LeadScopeError: class LeadScopeError extends Error {},
  pgLeadStore: {},
  recordLead: (...args: unknown[]) => recordLead(...args),
}));
vi.mock("../leads/notify-lead", () => ({
  notifyQualifiedLead: (...args: unknown[]) => notifyQualifiedLead(...args),
}));

import { FIT_SCORE_QUALIFIED, LEAD_ENGINE_INTAKE, LEGACY_INBOUND_INTAKE } from "@relay/db";
import { LeadScopeError } from "../leads/record-lead";
import { makeRecordLeadTool, recordLeadInputSchema } from "./record-lead-tool";

const CONTEXT = { toolCallId: "call-1", messages: [] };

function build(chatId: string | null = "chat-1") {
  return makeRecordLeadTool({
    agentId: "agent-1",
    companyId: "company-1",
    getChatId: () => chatId,
    intake: LEAD_ENGINE_INTAKE,
  });
}

function run(tool: ReturnType<typeof build>, input: Record<string, unknown>) {
  return tool.execute!(input as never, CONTEXT as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  recordLead.mockResolvedValue({
    recorded: true,
    id: "lead-1",
    status: "gathered",
    created: true,
    intakeComplete: false,
    missing: ["Budget"],
  });
  notifyQualifiedLead.mockResolvedValue("sent");
  recordFirstResponse.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("record_lead input schema", () => {
  it("has the intake keys and rejected, and no kod, tenant ids or phone", () => {
    const keys = Object.keys(recordLeadInputSchema(LEAD_ENGINE_INTAKE).shape);

    expect(keys).toEqual([
      "name",
      "company",
      "need",
      "budget",
      "timeline",
      "location",
      "rejected",
    ]);
    expect(keys).toEqual(
      expect.not.arrayContaining(["kod", "chatId", "companyId", "agentId", "phone"]),
    );
  });

  it("strips anything the model adds", () => {
    const parsed = recordLeadInputSchema(LEAD_ENGINE_INTAKE).parse({
      need: "kitchen",
      phone: "+1555",
      companyId: "x",
    });
    expect(parsed).toEqual({ need: "kitchen" });
  });

  it("strips a kod the model sends", () => {
    const parsed = recordLeadInputSchema(LEAD_ENGINE_INTAKE).parse({
      need: "kitchen",
      kod: "G7KF3",
    });
    expect(parsed).toEqual({ need: "kitchen" });
    expect(parsed).not.toHaveProperty("kod");
  });
});

describe("record_lead", () => {
  it("records under the closure's tenant and reports what is missing", async () => {
    const result = await run(build(), { need: "kitchen" });

    expect(recordLead).toHaveBeenCalledWith(
      {},
      { agentId: "agent-1", companyId: "company-1", chatId: "chat-1" },
      LEAD_ENGINE_INTAKE,
      { answers: { need: "kitchen" }, rejected: undefined },
    );
    expect(result).toEqual({
      success: true,
      recorded: true,
      status: "gathered",
      intakeComplete: false,
      missing: ["Budget"],
    });
    expect(notifyQualifiedLead).not.toHaveBeenCalled();
  });

  it("records the first response when it creates the lead", async () => {
    await run(build(), { need: "kitchen" });
    expect(recordFirstResponse).toHaveBeenCalledTimes(1);
    expect(recordFirstResponse).toHaveBeenCalledWith("chat-1");
  });

  it("does not record the first response for an existing lead", async () => {
    recordLead.mockResolvedValue({
      recorded: true,
      id: "lead-1",
      status: "gathered",
      created: false,
      intakeComplete: false,
      missing: ["Budget"],
    });
    await run(build(), { need: "kitchen" });
    expect(recordFirstResponse).not.toHaveBeenCalled();
  });

  it("notifies when the lead it landed on is qualified", async () => {
    recordLead.mockResolvedValue({
      recorded: true,
      id: "lead-1",
      status: "qualified",
      created: false,
      intakeComplete: true,
      missing: [],
    });

    await run(build(), { need: "kitchen" });

    expect(notifyQualifiedLead).toHaveBeenCalledWith("lead-1");
  });

  it("says nothing was recorded for a non-prospect", async () => {
    recordLead.mockResolvedValue({ recorded: false, reason: "not_a_prospect" });

    await expect(run(build(), { rejected: true })).resolves.toEqual({
      success: true,
      recorded: false,
    });
  });

  it("fails softly with no conversation yet", async () => {
    const result = await run(build(null), { need: "kitchen" });

    expect(result).toMatchObject({ success: false });
    expect(recordLead).not.toHaveBeenCalled();
  });

  it("returns the scope error to the model", async () => {
    recordLead.mockRejectedValue(new LeadScopeError("This conversation does not belong to this agent"));

    await expect(run(build(), { need: "kitchen" })).resolves.toEqual({
      success: false,
      error: "This conversation does not belong to this agent",
    });
  });

  it("describes the checklist and never asks for the phone", () => {
    const tool = build();
    expect(tool.description).toContain("Need (required)");
    expect(tool.description).toContain("Never ask for their phone number");
    expect(tool.description).toContain(
      "The campaign code is read from the first message automatically; do not ask for it.",
    );
  });
});

// W3GAP item 3: an agent with Lead capture on and no workflow (the legacy
// checklist) keeps the old captureLead behaviour: a complete checklist
// qualifies the lead at once, which notifies and opens its delivery card.
describe("record_lead on the legacy inbound checklist", () => {
  function buildLegacy(scoreOnComplete: boolean) {
    return makeRecordLeadTool({
      agentId: "agent-1",
      companyId: "company-1",
      getChatId: () => "chat-1",
      intake: LEGACY_INBOUND_INTAKE,
      scoreOnComplete,
    });
  }

  beforeEach(() => {
    recordLead.mockResolvedValue({
      recorded: true,
      id: "lead-1",
      status: "gathered",
      created: false,
      intakeComplete: true,
      missing: [],
    });
    scoreLead.mockResolvedValue({
      id: "lead-1",
      score: FIT_SCORE_QUALIFIED,
      band: "qualified",
      status: "qualified",
      route: "deliver",
      deliveryCheckpointId: "cp-1",
    });
  });

  it("scores a complete legacy lead as qualified in the lead's chat", async () => {
    const out = await run(buildLegacy(true) as never, { tip: "villa" });
    expect(scoreLead).toHaveBeenCalledWith({
      companyId: "company-1",
      agentId: "agent-1",
      recordId: "lead-1",
      score: FIT_SCORE_QUALIFIED,
      reasons: ["Intake checklist complete"],
      parent: { chatId: "chat-1" },
    });
    expect(out).toMatchObject({ success: true, status: "qualified" });
  });

  it("waits while the checklist is incomplete", async () => {
    recordLead.mockResolvedValue({
      recorded: true,
      id: "lead-1",
      status: "gathered",
      created: true,
      intakeComplete: false,
      missing: ["Bütçe"],
    });
    await run(buildLegacy(true) as never, { tip: "villa" });
    expect(scoreLead).not.toHaveBeenCalled();
  });

  it("leaves a lead fed to a workflow for the Qualify agent", async () => {
    await run(buildLegacy(false) as never, { tip: "villa" });
    expect(scoreLead).not.toHaveBeenCalled();
  });

  it("never re-scores a lead that is past intake", async () => {
    recordLead.mockResolvedValue({
      recorded: true,
      id: "lead-1",
      status: "rejected",
      created: false,
      intakeComplete: true,
      missing: [],
    });
    await run(buildLegacy(true) as never, { tip: "villa" });
    expect(scoreLead).not.toHaveBeenCalled();
  });
});
