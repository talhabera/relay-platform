import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findFirst,
  findMany,
  insertValues,
  updateSet,
  insert,
  update,
  transitionLeadStatus,
  insertLeadEvent,
} = vi.hoisted(() => ({
    transitionLeadStatus: vi.fn(),
    insertLeadEvent: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    insertValues: vi.fn(),
    updateSet: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  }));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    transitionLeadStatus,
    insertLeadEvent,
    db: {
      query: {
        companyRecords: { findFirst, findMany },
      },
      insert,
      update,
      transaction: (fn: (tx: unknown) => unknown) => fn({ insert, update }),
    },
  };
});

import {
  getCompanyRecord,
  searchCompanyRecords,
  upsertCompanyRecord,
} from "./company-records";

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const otherCompanyId = "550e8400-e29b-41d4-a716-446655440099";
const agentId = "660e8400-e29b-41d4-a716-446655440001";
const recordId = "aa0e8400-e29b-41d4-a716-446655440010";

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: recordId,
    companyId,
    sourceAgentId: agentId,
    entityType: "account" as const,
    name: "Acme",
    domain: "acme.com",
    payload: { findings: "old" },
    score: 4,
    status: "researched" as const,
    researchedAt: new Date("2026-08-20T12:00:00.000Z"),
    nextFollowUpAt: null,
    researchAttemptCount: 0,
    researchLastError: null,
    researchLockedAt: null,
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    updatedAt: new Date("2026-08-20T12:00:00.000Z"),
    ...overrides,
  };
}

describe("company memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(undefined);
    findMany.mockResolvedValue([]);
    insert.mockReturnValue({ values: insertValues });
    insertValues.mockImplementation((values: { status?: string; researchedAt?: Date | null }) => ({
      returning: vi.fn().mockResolvedValue([
        {
          id: "new-record-id",
          status: values.status ?? "pending",
          researchedAt: values.researchedAt ?? null,
        },
      ]),
    }));
    updateSet.mockImplementation(
      (values: { status?: string; researchedAt?: Date | null; id?: string }) => ({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: recordId,
              status: values.status ?? "researched",
              researchedAt: values.researchedAt ?? null,
            },
          ]),
        }),
      }),
    );
    update.mockReturnValue({ set: updateSet });
    transitionLeadStatus.mockResolvedValue({ changed: true, event: { id: "ev" } });
    insertLeadEvent.mockResolvedValue({ id: "ev" });
  });

  it("getCompanyRecord returns Not found for another company", async () => {
    findFirst.mockResolvedValue(record({ companyId: otherCompanyId }));

    await expect(
      getCompanyRecord({ companyId, recordId }),
    ).resolves.toEqual({ error: "Not found" });
  });

  it("defaults insert status to pending", async () => {
    await upsertCompanyRecord({
      companyId,
      sourceAgentId: agentId,
      entityType: "account",
      name: "Acme",
      domain: "acme.com",
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending" }),
    );
  });

  it("upsert stores empty domain as null", async () => {
    await upsertCompanyRecord({
      companyId,
      sourceAgentId: agentId,
      entityType: "account",
      name: "Acme",
      domain: "",
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ domain: null, sourceAgentId: agentId }),
    );
  });

  it("upsert merges the same domain instead of inserting again", async () => {
    findFirst.mockResolvedValue(record());

    const result = await upsertCompanyRecord({
      companyId,
      sourceAgentId: agentId,
      entityType: "account",
      name: "Acme Inc",
      domain: "acme.com",
      payload: { findings: "new" },
    });

    expect(insert).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalled();
    expect(result).toMatchObject({ id: recordId });
  });

  it("upsert stamps researchedAt when status is researched", async () => {
    const result = await upsertCompanyRecord({
      companyId,
      sourceAgentId: agentId,
      entityType: "account",
      name: "Acme",
      domain: "acme.com",
      status: "researched",
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "researched",
        researchedAt: expect.any(Date),
      }),
    );
    expect(result).toMatchObject({
      id: "new-record-id",
      status: "researched",
      researchedAt: expect.any(Date),
    });
  });

  it("logs the new record's creation, credited to the agent", async () => {
    await upsertCompanyRecord({
      companyId,
      sourceAgentId: agentId,
      entityType: "account",
      name: "Acme",
    });

    expect(insertLeadEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId,
        recordId: "new-record-id",
        fromStatus: null,
        toStatus: "pending",
        actor: { agentId },
      }),
    );
  });

  it("routes a status change through transitionLeadStatus with the other fields", async () => {
    findFirst.mockResolvedValue(record());

    const result = await upsertCompanyRecord({
      companyId,
      sourceAgentId: agentId,
      entityType: "account",
      name: "Acme",
      domain: "acme.com",
      score: 85,
      status: "interested",
    });

    expect(transitionLeadStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId,
        recordId,
        toStatus: "interested",
        actor: { agentId },
        set: expect.objectContaining({ score: 85, name: "Acme" }),
      }),
    );
    expect(updateSet).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: recordId, status: "interested" });
  });

  it("does not log anything when the status is unchanged", async () => {
    findFirst.mockResolvedValue(record());

    await upsertCompanyRecord({
      companyId,
      sourceAgentId: agentId,
      entityType: "account",
      name: "Acme",
      domain: "acme.com",
      status: "researched",
    });

    expect(transitionLeadStatus).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.not.objectContaining({ status: expect.anything() }),
    );
  });

  it("accepts a 0-100 fit score", async () => {
    const result = await upsertCompanyRecord({
      companyId,
      sourceAgentId: agentId,
      entityType: "account",
      name: "Acme",
      score: 100,
    });

    expect(result).not.toHaveProperty("error");
  });

  it("upsert rejects score 101", async () => {
    const result = await upsertCompanyRecord({
      companyId,
      sourceAgentId: agentId,
      entityType: "account",
      name: "Acme",
      score: 101,
    });

    expect(result).toEqual({
      error: expect.stringMatching(/score/i),
    });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("search omits payload from returned objects", async () => {
    findMany.mockResolvedValue([record({ payload: { secret: true } })]);

    const rows = await searchCompanyRecords({
      companyId,
      query: "acme",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: recordId,
      name: "Acme",
      domain: "acme.com",
      score: 4,
      status: "researched",
      researchedAt: record().researchedAt,
      nextFollowUpAt: null,
    });
    expect(rows[0]).not.toHaveProperty("payload");
  });

  it("search caps at 20", async () => {
    findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, index) =>
        record({ id: `rec-${index}`, name: `Account ${index}` }),
      ),
    );

    const rows = await searchCompanyRecords({
      companyId,
      query: "account",
    });

    expect(rows).toHaveLength(20);
  });
});
