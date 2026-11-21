import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findFirst,
  updateSet,
  update,
  updateWhere,
  updateReturning,
  transitionLeadStatus,
  recordFallbackActor,
} = vi.hoisted(() => ({
    transitionLeadStatus: vi.fn(),
    recordFallbackActor: vi.fn(),
    findFirst: vi.fn(),
    updateSet: vi.fn(),
    update: vi.fn(),
    updateWhere: vi.fn(),
    updateReturning: vi.fn(),
  }));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    transitionLeadStatus,
    recordFallbackActor,
    db: {
      query: {
        companyRecords: { findFirst },
      },
      update,
    },
  };
});

import {
  RESEARCH_MAX_ATTEMPTS,
  RESEARCH_STALE_MS,
  claimResearch,
} from "./claim-research";

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const otherCompanyId = "550e8400-e29b-41d4-a716-446655440099";
const recordId = "aa0e8400-e29b-41d4-a716-446655440010";
const now = new Date("2026-09-03T12:00:00.000Z");

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: recordId,
    companyId,
    sourceAgentId: "660e8400-e29b-41d4-a716-446655440001",
    entityType: "account" as const,
    name: "Acme",
    domain: "acme.com",
    payload: {},
    score: null,
    status: "pending" as const,
    researchedAt: null,
    nextFollowUpAt: null,
    researchAttemptCount: 0,
    researchLastError: null,
    researchLockedAt: null,
    createdAt: new Date("2026-08-01T12:00:00.000Z"),
    updatedAt: new Date("2026-08-01T12:00:00.000Z"),
    ...overrides,
  };
}

describe("claimResearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(undefined);
    updateWhere.mockReturnValue({ returning: updateReturning });
    updateSet.mockReturnValue({ where: updateWhere });
    update.mockReturnValue({ set: updateSet });
    updateReturning.mockResolvedValue([]);
    transitionLeadStatus.mockResolvedValue({ changed: true, event: { id: "ev" } });
    recordFallbackActor.mockImplementation(async (_db, row) => ({
      agentId: row.sourceAgentId,
    }));
  });

  it("claims a pending row through the lead event log, crediting the record's agent", async () => {
    findFirst.mockResolvedValue(
      record({ status: "pending", researchAttemptCount: 1 }),
    );

    const result = await claimResearch({ companyId, recordId, now });

    expect(result).toEqual({ ok: true });
    expect(transitionLeadStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId,
        recordId,
        toStatus: "processing",
        actor: { agentId: "660e8400-e29b-41d4-a716-446655440001" },
        guard: expect.anything(),
        set: expect.objectContaining({
          researchLockedAt: now,
          researchAttemptCount: expect.anything(),
        }),
      }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("returns locked when a concurrent claim won the guard", async () => {
    findFirst.mockResolvedValue(record({ status: "failed" }));
    transitionLeadStatus.mockResolvedValue({ changed: false, reason: "guard_failed" });

    const result = await claimResearch({ companyId, recordId, now });

    expect(result).toEqual({ error: "locked" });
  });

  it("returns locked for processing row with a fresh lock", async () => {
    const lockedAt = new Date(now.getTime() - 60_000);
    findFirst.mockResolvedValue(
      record({
        status: "processing",
        researchLockedAt: lockedAt,
        researchAttemptCount: 1,
      }),
    );

    const result = await claimResearch({ companyId, recordId, now });

    expect(result).toEqual({ error: "locked" });
  });

  it("claims a processing row with a stale lock", async () => {
    const lockedAt = new Date(now.getTime() - RESEARCH_STALE_MS - 60_000);
    findFirst.mockResolvedValue(
      record({
        status: "processing",
        researchLockedAt: lockedAt,
        researchAttemptCount: 2,
      }),
    );
    updateReturning.mockResolvedValue([{ id: recordId }]);

    const result = await claimResearch({ companyId, recordId, now });

    expect(result).toEqual({ ok: true });
    // Same status: no lead event.
    expect(transitionLeadStatus).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.not.objectContaining({ status: expect.anything() }),
    );
  });

  it("returns locked for outreach_pending status", async () => {
    findFirst.mockResolvedValue(record({ status: "outreach_pending" }));

    const result = await claimResearch({ companyId, recordId, now });

    expect(result).toEqual({ error: "locked" });
    expect(transitionLeadStatus).not.toHaveBeenCalled();
  });

  it("returns not_found when the record id is missing", async () => {
    const result = await claimResearch({ companyId, recordId, now });

    expect(result).toEqual({ error: "not_found" });
    expect(update).not.toHaveBeenCalled();
  });

  it("returns not_found when the record belongs to another company", async () => {
    findFirst.mockResolvedValue(record({ companyId: otherCompanyId }));

    const result = await claimResearch({ companyId, recordId, now });

    expect(result).toEqual({ error: "not_found" });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("claimResearch constants", () => {
  it("exports research queue constants", () => {
    expect(RESEARCH_STALE_MS).toBe(5 * 60 * 1000);
    expect(RESEARCH_MAX_ATTEMPTS).toBe(3);
  });
});
