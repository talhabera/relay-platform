import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";

const { transitionLeadStatus } = vi.hoisted(() => ({
  transitionLeadStatus: vi.fn(),
}));

const { notifyQualifiedLeadOnWorker } = vi.hoisted(() => ({
  notifyQualifiedLeadOnWorker: vi.fn(async () => true),
}));
vi.mock("@/lib/worker-proxy", () => ({ notifyQualifiedLeadOnWorker }));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return { ...actual, transitionLeadStatus };
});

import {
  acceptBorderlineLead,
  editLead,
  excludeLead,
  LeadEditError,
  moveLeadStatus,
  normalizeLeadEdit,
  PERSON_EXCLUDE_REASON,
  PERSON_REJECT_REASON,
  QUALIFY_INSTRUCTIONS,
  rejectBorderlineLead,
} from ".";

const base = { companyId: "co-1", leadId: "lead-1", userId: "u-1" };

function guardSql(callIndex = 0) {
  const guard = transitionLeadStatus.mock.calls[callIndex]![1].guard as SQL;
  return new PgDialect().sqlToQuery(guard);
}

const { emitPortalEvent } = vi.hoisted(() => ({ emitPortalEvent: vi.fn(async () => ({})) }));
vi.mock("@/lib/live/portal-events", () => ({ emitPortalEvent }));

const leadRow = vi.fn(async () => [{ name: "Ayşe", source: "whatsapp" }] as unknown[]);

beforeEach(() => {
  vi.clearAllMocks();
  transitionLeadStatus.mockResolvedValue({ changed: true, event: { id: "ev" } });
  leadRow.mockResolvedValue([{ name: "Ayşe", source: "whatsapp" }]);
  const tx = { select: () => ({ from: () => ({ where: leadRow }) }) };
  (db as unknown as { transaction: unknown }).transaction = async (
    fn: (t: unknown) => unknown,
  ) => fn(tx);
});

describe("Borderline accept / reject", () => {
  it("accept of an inbound lead writes the Live feed row and notifies (decision 16)", async () => {
    await acceptBorderlineLead(base);
    expect(emitPortalEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "lead_inbound_qualified",
        title: "Ayşe",
        channel: "whatsapp",
        refId: "lead-1",
      }),
    );
    expect(notifyQualifiedLeadOnWorker).toHaveBeenCalledWith("lead-1");
  });

  it("accept of an outbound lead neither emits nor notifies", async () => {
    leadRow.mockResolvedValue([{ name: "Acme", source: "outbound" }]);
    await acceptBorderlineLead(base);
    expect(emitPortalEvent).not.toHaveBeenCalled();
    expect(notifyQualifiedLeadOnWorker).not.toHaveBeenCalled();
  });

  it("no notification when the accept did not move the lead", async () => {
    transitionLeadStatus.mockResolvedValue({ changed: false, reason: "guard_failed" });
    await acceptBorderlineLead(base);
    expect(notifyQualifiedLeadOnWorker).not.toHaveBeenCalled();
  });

  it("exclude never notifies", async () => {
    await excludeLead(base);
    expect(notifyQualifiedLeadOnWorker).not.toHaveBeenCalled();
  });


  it("accept makes a borderline lead qualified, logged with the person, score untouched", async () => {
    await expect(acceptBorderlineLead(base)).resolves.toEqual({ ok: true });

    const input = transitionLeadStatus.mock.calls[0]![1];
    expect(input).toMatchObject({
      companyId: "co-1",
      recordId: "lead-1",
      toStatus: "qualified",
      actor: { userId: "u-1" },
    });
    expect(input.set).toBeUndefined();
    expect(guardSql().sql).toContain(`= 'borderline'`);
  });

  it("reject keeps the score and writes one reject reason", async () => {
    await rejectBorderlineLead({ ...base, reason: " Too small " });
    const input = transitionLeadStatus.mock.calls[0]![1];
    expect(input).toMatchObject({
      toStatus: "rejected",
      actor: { userId: "u-1" },
      set: { rejectReason: "Too small" },
    });
    expect(input.set).not.toHaveProperty("score");
    expect(guardSql().sql).toContain(`= 'borderline'`);
  });

  it("refuses a lead that is no longer borderline", async () => {
    transitionLeadStatus.mockResolvedValue({ changed: false, reason: "guard_failed" });
    await expect(acceptBorderlineLead(base)).resolves.toEqual({
      ok: false,
      reason: "not_allowed",
    });
    transitionLeadStatus.mockResolvedValue({ changed: false, reason: "not_found" });
    await expect(rejectBorderlineLead(base)).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("excludeLead", () => {
  it("moves any open lead to rejected, logged with the person", async () => {
    await expect(excludeLead(base)).resolves.toEqual({ ok: true });
    const input = transitionLeadStatus.mock.calls[0]![1];
    expect(input).toMatchObject({
      toStatus: "rejected",
      actor: { userId: "u-1" },
      set: { rejectReason: PERSON_EXCLUDE_REASON },
    });
    const { sql, params } = guardSql();
    expect(sql).toContain("not in");
    expect(params).toEqual(["rejected", "delivered", "won"]);
  });

  it("never touches a won lead: the guard excludes won too", async () => {
    await excludeLead(base);
    const { sql, params } = guardSql();
    expect(sql).toContain("not in");
    expect(params).toContain("won");
  });

  it("only appends an event, so an excluded qualified lead keeps its billing event", async () => {
    // Billing (listQualifiedLeads) counts the first `qualified` event; exclude
    // goes through transitionLeadStatus, which appends and never deletes.
    await excludeLead(base);
    expect(transitionLeadStatus).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db).delete).not.toHaveBeenCalled();
  });
});

describe("moveLeadStatus", () => {
  const input = () => transitionLeadStatus.mock.calls[0]![1];

  it.each(["meeting", "proposal"] as const)("moves to %s as the person, no set", async (toStatus) => {
    await expect(moveLeadStatus({ ...base, toStatus })).resolves.toEqual({ ok: true });
    expect(transitionLeadStatus).toHaveBeenCalledTimes(1);
    expect(input()).toMatchObject({ companyId: "co-1", recordId: "lead-1", toStatus, actor: { userId: "u-1" } });
    expect(input().set).toBeUndefined();
  });

  it("refuses won without a package and a positive integer amount", async () => {
    for (const sale of [
      {},
      { salePackage: "website" as const },
      { saleAmountMinor: 8_000_000 },
      { salePackage: "website" as const, saleAmountMinor: 0 },
      { salePackage: "website" as const, saleAmountMinor: -5 },
      { salePackage: "social" as const, saleAmountMinor: 12.5 },
      { salePackage: "other" as "website", saleAmountMinor: 100 },
    ]) {
      await expect(moveLeadStatus({ ...base, toStatus: "won", ...sale })).resolves.toEqual({
        ok: false,
        reason: "sale_required",
      });
    }
    expect(transitionLeadStatus).not.toHaveBeenCalled();
  });

  it("won writes the package and amount", async () => {
    await expect(
      moveLeadStatus({ ...base, toStatus: "won", salePackage: "website", saleAmountMinor: 8_000_000 }),
    ).resolves.toEqual({ ok: true });
    expect(input()).toMatchObject({
      toStatus: "won",
      actor: { userId: "u-1" },
      set: { salePackage: "website", saleAmountMinor: 8_000_000 },
    });
  });

  it("leaving won keeps the package and amount (no set clearing)", async () => {
    await moveLeadStatus({ ...base, toStatus: "meeting" });
    expect(input().set).toBeUndefined();
    vi.clearAllMocks();
    transitionLeadStatus.mockResolvedValue({ changed: true, event: { id: "ev" } });
    await moveLeadStatus({ ...base, toStatus: "unqualified", reopen: true });
    expect(input().set).toEqual({ rejectReason: PERSON_REJECT_REASON });
  });

  it.each(["unqualified", "rejected"] as const)(
    "a won lead goes to %s only with reopen: true",
    async (toStatus) => {
      await moveLeadStatus({ ...base, toStatus });
      const closed = guardSql(0);
      expect(closed.sql).toContain("not in");
      expect(closed.params).toEqual(["won"]);

      await moveLeadStatus({ ...base, toStatus, reopen: true });
      expect(transitionLeadStatus.mock.calls[1]![1].guard).toBeUndefined();
    },
  );

  it("refused guard is not_allowed", async () => {
    transitionLeadStatus.mockResolvedValue({ changed: false, reason: "guard_failed" });
    await expect(moveLeadStatus({ ...base, toStatus: "rejected" })).resolves.toEqual({
      ok: false,
      reason: "not_allowed",
    });
  });

  it("unqualified and rejected set a reject reason", async () => {
    await moveLeadStatus({ ...base, toStatus: "unqualified", reason: " Bütçe yok " });
    expect(input().set).toEqual({ rejectReason: "Bütçe yok" });
    await moveLeadStatus({ ...base, toStatus: "rejected" });
    expect(transitionLeadStatus.mock.calls[1]![1].set).toEqual({ rejectReason: PERSON_REJECT_REASON });
  });

  it("refuses a target outside the Koleva funnel", async () => {
    for (const toStatus of ["outreach_pending", "delivered", "borderline"] as const) {
      await expect(moveLeadStatus({ ...base, toStatus })).resolves.toEqual({
        ok: false,
        reason: "not_allowed",
      });
    }
    expect(transitionLeadStatus).not.toHaveBeenCalled();
  });

  it("proposal and won exclude rejected and delivered sources", async () => {
    await moveLeadStatus({ ...base, toStatus: "proposal" });
    await moveLeadStatus({ ...base, toStatus: "won", salePackage: "social", saleAmountMinor: 2_500_000 });
    for (const i of [0, 1]) {
      const { sql, params } = guardSql(i);
      expect(sql).toContain("not in");
      expect(params).toEqual(["rejected", "delivered"]);
    }
  });

  it.each(["qualified", "meeting", "gathered"] as const)("%s has no guard", async (toStatus) => {
    await moveLeadStatus({ ...base, toStatus });
    expect(input().guard).toBeUndefined();
  });

  it("back to qualified does not notify (only the borderline accept does)", async () => {
    await expect(moveLeadStatus({ ...base, toStatus: "qualified" })).resolves.toEqual({ ok: true });
    expect(notifyQualifiedLeadOnWorker).not.toHaveBeenCalled();
    expect(emitPortalEvent).not.toHaveBeenCalled();
    expect(vi.mocked(db).delete).not.toHaveBeenCalled();
  });
});

describe("editLead", () => {
  it("normalizes the edit", () => {
    expect(
      normalizeLeadEdit({ name: " Ayse ", phone: "+90 532 123 45 67", intake: { m2: " 120 ", kod: null } }),
    ).toEqual({ name: "Ayse", phone: "+905321234567", intake: { m2: "120", kod: null } });
    expect(() => normalizeLeadEdit({ phone: "0532" })).toThrow(LeadEditError);
    expect(() => normalizeLeadEdit({ name: " " })).toThrow(LeadEditError);
  });

  it("merges intake answers and logs no lead event", async () => {
    const set = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            for: async () => [{ payload: { intake: { tip: "ofis", kod: "K1" }, other: 1 } }],
          }),
        }),
      }),
      update: () => ({ set }),
    };
    (db as unknown as Record<string, unknown>).transaction = vi.fn(
      async (fn: (t: typeof tx) => unknown) => fn(tx),
    );

    await expect(
      editLead({ companyId: "co-1", leadId: "lead-1", edit: { intake: { m2: "120", kod: null } } }),
    ).resolves.toEqual({ ok: true });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { intake: { tip: "ofis", m2: "120" }, other: 1 },
      }),
    );
    const written = (set.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(written).not.toHaveProperty("status");
    expect(written).not.toHaveProperty("score");
    expect(transitionLeadStatus).not.toHaveBeenCalled();
  });

  it("reports a phone another lead already has", async () => {
    (db as unknown as Record<string, unknown>).transaction = vi.fn(async () => {
      throw Object.assign(new Error("duplicate"), { code: "23505" });
    });
    await expect(
      editLead({ companyId: "co-1", leadId: "lead-1", edit: { phone: "+905321234567" } }),
    ).resolves.toEqual({ ok: false, reason: "duplicate_phone" });
  });
});

describe("QUALIFY_INSTRUCTIONS", () => {
  it("carries the bands, reasons rule, 24 h quiet rule and the no-question rule", () => {
    expect(QUALIFY_INSTRUCTIONS).toContain("70 or more: qualified");
    expect(QUALIFY_INSTRUCTIONS).toContain("50-69: borderline");
    expect(QUALIFY_INSTRUCTIONS).toContain("Under 50: rejected");
    expect(QUALIFY_INSTRUCTIONS).toContain("1 to 3 short fit reasons");
    expect(QUALIFY_INSTRUCTIONS).toContain("24 hours");
    expect(QUALIFY_INSTRUCTIONS).toContain("do not call ask_operator");
    expect(QUALIFY_INSTRUCTIONS).toContain("skips outreach");
  });
});
