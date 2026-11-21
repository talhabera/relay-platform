import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  recordFindFirst,
  companyFindFirst,
  getCompanyRecord,
  pendingFindFirst,
  pendingFindMany,
  insert,
  insertValues,
  insertOnConflict,
  update,
  updateSet,
  transitionLeadStatus,
} = vi.hoisted(() => ({
  recordFindFirst: vi.fn(),
  companyFindFirst: vi.fn(),
  transitionLeadStatus: vi.fn(),
  insertOnConflict: vi.fn(),
  getCompanyRecord: vi.fn(),
  pendingFindFirst: vi.fn(),
  pendingFindMany: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
}));

vi.mock("./company-records", () => ({
  getCompanyRecord,
}));

import { chats, checkpointArtifactHash, checkpoints } from "@relay/db";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    transitionLeadStatus,
    db: {
      query: {
        checkpoints: {
          findFirst: pendingFindFirst,
          findMany: pendingFindMany,
        },
        companyRecords: { findFirst: recordFindFirst },
        companies: { findFirst: companyFindFirst },
      },
      insert,
      update,
    },
  };
});

import { proposeLeadDelivery, proposeOutreach } from "./propose-action";

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const agentId = "660e8400-e29b-41d4-a716-446655440001";
const chatId = "770e8400-e29b-41d4-a716-446655440002";
const cronRunId = "880e8400-e29b-41d4-a716-446655440003";
const recordId = "aa0e8400-e29b-41d4-a716-446655440010";
const pendingId = "bb0e8400-e29b-41d4-a716-446655440011";

const researchedRecord = {
  id: recordId,
  companyId,
  name: "Acme",
  domain: "acme.com",
  status: "researched" as const,
  payload: {},
  score: 7,
  entityType: "account" as const,
  sourceAgentId: agentId,
  researchedAt: new Date("2026-08-20T12:00:00.000Z"),
  nextFollowUpAt: null,
  createdAt: new Date("2026-08-01T12:00:00.000Z"),
  updatedAt: new Date("2026-08-20T12:00:00.000Z"),
};

const baseInput = {
  recordId,
  actionType: "outreach" as const,
  channel: "copy" as const,
  recipient: "ada@acme.com",
  body: "Hello Acme, here is a tailored note.",
  reason: "Good fit for outbound",
};

function opts(
  overrides: Partial<Parameters<typeof proposeOutreach>[0]> = {},
) {
  return {
    companyId,
    agentId,
    chatId,
    input: { ...baseInput },
    ...overrides,
  };
}

describe("proposeOutreach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCompanyRecord.mockResolvedValue(researchedRecord);
    pendingFindFirst.mockResolvedValue(undefined);
    pendingFindMany.mockResolvedValue([]);
    insert.mockReturnValue({ values: insertValues });
    insertValues.mockImplementation(() => ({
      onConflictDoNothing: insertOnConflict,
    }));
    insertOnConflict.mockImplementation(() => ({
      returning: vi.fn().mockResolvedValue([{ id: pendingId }]),
    }));
    updateSet.mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
    update.mockReturnValue({ set: updateSet });
  });

  it("reports already pending when a concurrent propose won the unique index", async () => {
    // Both requests passed the pending read; the insert hits
    // checkpoints_record_pending_uidx and returns no row.
    insertOnConflict.mockImplementation(() => ({
      returning: vi.fn().mockResolvedValue([]),
    }));

    await expect(proposeOutreach(opts())).resolves.toEqual({
      error: "Outreach already waiting for Send",
    });
    expect(insertOnConflict).toHaveBeenCalledWith(
      expect.objectContaining({ target: checkpoints.recordId }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects when parent session is missing", async () => {
    await expect(
      proposeOutreach({
        companyId,
        agentId,
        input: baseInput,
      }),
    ).resolves.toEqual({ error: "Parent session missing" });
  });

  it("rejects a missing record", async () => {
    getCompanyRecord.mockResolvedValue({ error: "Not found" });
    await expect(proposeOutreach(opts())).resolves.toEqual({
      error: "Not found",
    });
  });

  it("rejects status pending", async () => {
    getCompanyRecord.mockResolvedValue({
      ...researchedRecord,
      status: "pending",
    });
    await expect(proposeOutreach(opts())).resolves.toEqual({
      error: "Research this account first",
    });
  });

  it("rejects status processing", async () => {
    getCompanyRecord.mockResolvedValue({
      ...researchedRecord,
      status: "processing",
    });
    await expect(proposeOutreach(opts())).resolves.toEqual({
      error: "Research this account first",
    });
  });

  it("rejects status failed", async () => {
    getCompanyRecord.mockResolvedValue({
      ...researchedRecord,
      status: "failed",
    });
    await expect(proposeOutreach(opts())).resolves.toEqual({
      error: "Research this account first",
    });
  });

  it("rejects existing pending outreach", async () => {
    pendingFindFirst.mockResolvedValue({ id: "already-pending" });
    await expect(proposeOutreach(opts())).resolves.toEqual({
      error: "Outreach already waiting for Send",
    });
  });

  it("rejects cooldown within 3 days", async () => {
    pendingFindFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        status: "approved",
        resolvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });
    await expect(proposeOutreach(opts())).resolves.toEqual({
      error: "Last approved outreach is within 3 days",
    });
  });

  it("rejects the 11th cron follow-up", async () => {
    pendingFindMany.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ id: `p-${i}` })));
    await expect(
      proposeOutreach(
        opts({ chatId: undefined, cronRunId }),
      ),
    ).resolves.toEqual({ error: "Follow-up cap of 10 for this run" });
  });

  it("rejects email without subject", async () => {
    await expect(
      proposeOutreach(
        opts({
          input: { ...baseInput, channel: "email" },
        }),
      ),
    ).resolves.toEqual({ error: "Email subject is required" });
  });

  it("rejects a body longer than 8000", async () => {
    await expect(
      proposeOutreach(
        opts({
          input: { ...baseInput, body: "x".repeat(8001) },
        }),
      ),
    ).resolves.toEqual({ error: "Message is too long" });
  });

  it("inserts a copy action with null snapshot", async () => {
    const result = await proposeOutreach(opts());

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        agentId,
        chatId,
        cronRunId: null,
        recordId,
        kind: "outreach",
        status: "pending",
        endpointSnapshot: null,
        payload: expect.objectContaining({
          kind: "outreach",
          channel: "copy",
          recipient: baseInput.recipient,
          body: baseInput.body,
          reason: baseInput.reason,
          recordName: "Acme",
          domain: "acme.com",
        }),
      }),
    );
    expect(transitionLeadStatus).toHaveBeenCalledWith(
      expect.anything(),
      {
        companyId,
        recordId,
        toStatus: "outreach_pending",
        actor: { agentId },
      },
    );
    expect(result).toEqual({
      status: "pending_approval",
      pendingId,
      kind: "action",
      actionType: "outreach",
      toolName: "proposeAction",
      channel: "copy",
      recipient: baseInput.recipient,
      body: baseInput.body,
      reason: baseInput.reason,
      recordName: "Acme",
      message: "Wait for Send or Reject.",
    });
  });

  it("stores the draft hash so an edit can mark the card stale", async () => {
    await proposeOutreach(opts());
    const values = insertValues.mock.calls[0][0];
    expect(values.artifactHash).toBe(checkpointArtifactHash(values.payload));
  });

  it("sets the session to needs_you and bumps last activity", async () => {
    await proposeOutreach(opts());
    expect(update).toHaveBeenCalledWith(chats);
    expect(updateSet).toHaveBeenCalledWith({
      status: "needs_you",
      lastActivityAt: expect.any(Date),
    });
  });

  it("supersedes the card it revises", async () => {
    await proposeOutreach(opts());
    expect(update).toHaveBeenCalledWith(checkpoints);
    expect(updateSet).toHaveBeenCalledWith({ supersededBy: pendingId });
  });

  it("does not touch chats for a Schedule run card", async () => {
    await proposeOutreach(opts({ chatId: undefined, cronRunId }));
    expect(update).not.toHaveBeenCalledWith(chats);
    expect(updateSet).toHaveBeenCalledWith({ supersededBy: pendingId });
  });

  it("inserts null endpoint snapshot", async () => {
    await proposeOutreach(opts());

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ endpointSnapshot: null }),
    );
  });

  it("chat force true bypasses cooldown", async () => {
    pendingFindFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        status: "approved",
        resolvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });

    const result = await proposeOutreach(
      opts({ input: { ...baseInput, force: true } }),
    );

    expect(result).toMatchObject({ status: "pending_approval", pendingId });
  });

  it("cron ignores force and still applies cooldown", async () => {
    pendingFindFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        status: "approved",
        resolvedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });

    await expect(
      proposeOutreach(
        opts({
          chatId: undefined,
          cronRunId,
          input: { ...baseInput, force: true },
        }),
      ),
    ).resolves.toEqual({
      error: "Last approved outreach is within 3 days",
    });
  });
});

// W3GAP item 1: the deliver-to-client card for a qualified inbound lead.
describe("proposeLeadDelivery", () => {
  const lead = {
    id: recordId,
    companyId,
    name: "Ayse",
    phone: "+905551112233",
    status: "qualified",
    source: "whatsapp",
    score: 82,
    chatId: "cc0e8400-e29b-41d4-a716-446655440020",
    sourceAgentId: agentId,
    payload: { intake: { tip: "villa", m2: "140" } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    recordFindFirst.mockResolvedValue(lead);
    companyFindFirst.mockResolvedValue({ id: companyId, leadNotifyWhatsapp: "+905320000000" });
    insert.mockReturnValue({ values: insertValues });
    insertValues.mockImplementation(() => ({ onConflictDoNothing: insertOnConflict }));
    insertOnConflict.mockImplementation(() => ({
      returning: vi.fn().mockResolvedValue([{ id: pendingId }]),
    }));
  });

  it("opens a pending lead_delivery card with the S06 payload", async () => {
    await expect(
      proposeLeadDelivery({ companyId, recordId, agentId, parent: { cronRunId } }),
    ).resolves.toEqual({ proposed: true, pendingId });
    expect(insert).toHaveBeenCalledWith(checkpoints);
    const values = insertValues.mock.calls[0][0];
    expect(values).toMatchObject({
      companyId,
      agentId,
      chatId: null,
      cronRunId,
      recordId,
      kind: "lead_delivery",
      status: "pending",
      payload: {
        kind: "lead_delivery",
        leadId: recordId,
        channel: "whatsapp",
        recipient: "+905320000000",
        reason: "Qualified inbound lead, fit 82",
      },
    });
    expect(values.payload.summary).toContain("Ad: Ayse");
    expect(values.payload.summary).toContain("tip: villa");
    expect(values.artifactHash).toBe(checkpointArtifactHash(values.payload));
  });

  it("parents the card on the lead's chat and credits its source agent by default", async () => {
    await proposeLeadDelivery({ companyId, recordId });
    expect(insertValues.mock.calls[0][0]).toMatchObject({
      agentId,
      chatId: lead.chatId,
      cronRunId: null,
    });
  });

  it("skips a lead already delivered", async () => {
    recordFindFirst.mockResolvedValue({ ...lead, status: "delivered" });
    await expect(proposeLeadDelivery({ companyId, recordId })).resolves.toEqual({
      proposed: false,
      reason: "delivered",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("skips a lead that is not qualified", async () => {
    recordFindFirst.mockResolvedValue({ ...lead, status: "borderline" });
    await expect(proposeLeadDelivery({ companyId, recordId })).resolves.toMatchObject({
      proposed: false,
      reason: "not_qualified",
    });
  });

  it("skips when the company has no lead number", async () => {
    companyFindFirst.mockResolvedValue({ id: companyId, leadNotifyWhatsapp: null });
    await expect(proposeLeadDelivery({ companyId, recordId })).resolves.toMatchObject({
      proposed: false,
      reason: "no_recipient",
    });
  });

  it("is a no-op while a card for the record is pending", async () => {
    insertOnConflict.mockImplementation(() => ({
      returning: vi.fn().mockResolvedValue([]),
    }));
    await expect(proposeLeadDelivery({ companyId, recordId })).resolves.toEqual({
      proposed: false,
      reason: "already_pending",
    });
  });
});
