import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const { recordFindFirst, transitionLeadStatus, selectChain } = vi.hoisted(() => {
  const selectChain = {
    where: vi.fn(),
    rows: [] as unknown[],
  };
  return {
    recordFindFirst: vi.fn(),
    transitionLeadStatus: vi.fn(),
    selectChain,
  };
});

const { notifyQualifiedLead, portalInsert } = vi.hoisted(() => ({
  notifyQualifiedLead: vi.fn(),
  portalInsert: vi.fn(async () => undefined),
}));
vi.mock("./notify-lead", () => ({
  notifyQualifiedLead: (...a: unknown[]) => notifyQualifiedLead(...a),
}));
const { proposeLeadDelivery } = vi.hoisted(() => ({ proposeLeadDelivery: vi.fn() }));
vi.mock("../operator/propose-action", () => ({
  proposeLeadDelivery: (...a: unknown[]) => proposeLeadDelivery(...a),
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    transitionLeadStatus,
    db: {
      transaction: async (fn: (tx: unknown) => unknown) =>
        fn({ insert: () => ({ values: portalInsert }) }),
      query: { companyRecords: { findFirst: recordFindFirst } },
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: (cond: SQL) => {
              selectChain.where(cond);
              return {
                orderBy: () => ({ limit: async () => selectChain.rows }),
              };
            },
          }),
        }),
      }),
    },
  };
});

import {
  listLeadsToQualify,
  routeAfterQualify,
  scoreLead,
  validateScore,
} from "./score-lead";

const base = {
  companyId: "co-1",
  agentId: "ag-q",
  recordId: "rec-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  recordFindFirst.mockResolvedValue({
    id: "rec-1",
    companyId: "co-1",
    status: "gathered",
    source: "outbound",
  });
  transitionLeadStatus.mockResolvedValue({ changed: true, event: { id: "ev" } });
  proposeLeadDelivery.mockResolvedValue({ proposed: true, pendingId: "cp-1" });
});

describe("validateScore", () => {
  it("needs 1-3 reasons", () => {
    expect(validateScore({ score: 80, reasons: [] })).toMatchObject({ ok: false });
    expect(validateScore({ score: 80, reasons: ["a", "b", "c", "d"] })).toMatchObject({
      ok: false,
    });
    expect(validateScore({ score: 80, reasons: [" a ", ""] })).toEqual({
      ok: true,
      band: "qualified",
      reasons: ["a"],
      rejectReason: null,
    });
  });

  it("needs exactly one reject reason under 50, and none at 50 or more", () => {
    expect(validateScore({ score: 49, reasons: ["a"] })).toMatchObject({ ok: false });
    expect(
      validateScore({ score: 49, reasons: ["a"], rejectReason: "Too small" }),
    ).toMatchObject({ ok: true, band: "rejected", rejectReason: "Too small" });
    expect(
      validateScore({ score: 50, reasons: ["a"], rejectReason: "x" }),
    ).toMatchObject({ ok: false });
  });

  it("refuses scores outside 0-100", () => {
    expect(validateScore({ score: 101, reasons: ["a"] })).toMatchObject({ ok: false });
    expect(validateScore({ score: 7.5, reasons: ["a"] })).toMatchObject({ ok: false });
  });
});

describe("routeAfterQualify", () => {
  it("sends qualified outbound to outreach and qualified inbound straight to delivery", () => {
    expect(routeAfterQualify("qualified", "outbound")).toBe("outreach");
    expect(routeAfterQualify("qualified", null)).toBe("outreach");
    expect(routeAfterQualify("qualified", "whatsapp")).toBe("deliver");
    expect(routeAfterQualify("qualified", "widget")).toBe("deliver");
  });

  it("holds borderline in the filter and puts rejected in Excluded, inbound or not", () => {
    expect(routeAfterQualify("borderline", "whatsapp")).toBe("borderline");
    expect(routeAfterQualify("borderline", "outbound")).toBe("borderline");
    expect(routeAfterQualify("rejected", "instagram")).toBe("excluded");
  });
});

describe("scoreLead", () => {
  it("notifies once an inbound lead is scored qualified (decision 16)", async () => {
    recordFindFirst.mockResolvedValue({ id: "rec-1", companyId: "co-1", name: "Ayşe", status: "gathered", source: "whatsapp" });

    await scoreLead({ ...base, score: 82, reasons: ["Budget fits"] });

    expect(notifyQualifiedLead).toHaveBeenCalledWith("rec-1");
  });

  it("writes one lead_inbound_qualified Live feed row for an inbound qualified lead", async () => {
    recordFindFirst.mockResolvedValue({
      id: "rec-1",
      companyId: "co-1",
      name: "Ayşe",
      status: "gathered",
      source: "whatsapp",
    });

    await scoreLead({ ...base, score: 82, reasons: ["Budget fits"] });

    expect(portalInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-1",
        type: "lead_inbound_qualified",
        title: "Ayşe",
        channel: "whatsapp",
        refId: "rec-1",
      }),
    );
  });

  it("does not notify for borderline, or for an outbound lead", async () => {
    recordFindFirst.mockResolvedValue({ id: "rec-1", companyId: "co-1", name: "Ayşe", status: "gathered", source: "whatsapp" });
    await scoreLead({ ...base, score: 62, reasons: ["Small"] });
    recordFindFirst.mockResolvedValue({ id: "rec-1", companyId: "co-1", status: "gathered", source: "outbound" });
    await scoreLead({ ...base, score: 90, reasons: ["Great"] });

    expect(notifyQualifiedLead).not.toHaveBeenCalled();
    expect(portalInsert).not.toHaveBeenCalled();
  });


  it("moves the lead to its band, logged with the agent, writing score and reasons", async () => {
    const result = await scoreLead({ ...base, score: 62, reasons: ["Under 20 employees"] });

    expect(result).toEqual({
      id: "rec-1",
      score: 62,
      band: "borderline",
      status: "borderline",
      route: "borderline",
    });
    expect(transitionLeadStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "co-1",
        recordId: "rec-1",
        toStatus: "borderline",
        actor: { agentId: "ag-q" },
        set: { score: 62, fitReasons: ["Under 20 employees"], rejectReason: null },
      }),
    );
  });

  it("only scores leads not yet decided (the guard keeps a person's override)", async () => {
    await scoreLead({ ...base, score: 75, reasons: ["Fits"] });
    const guard = transitionLeadStatus.mock.calls[0]![1].guard as SQL;
    const { sql, params } = new PgDialect().sqlToQuery(guard);
    expect(sql).toContain('"status" in');
    expect(params).toEqual(["pending", "researched", "gathered"]);
  });

  it("reports an already-decided lead instead of re-scoring it", async () => {
    recordFindFirst.mockResolvedValue({ id: "rec-1", status: "qualified", source: null });
    transitionLeadStatus.mockResolvedValue({ changed: false, reason: "guard_failed" });

    const result = await scoreLead({ ...base, score: 40, reasons: ["x"], rejectReason: "y" });
    expect(result).toMatchObject({ error: expect.stringContaining("already qualified") });
  });

  it("routes a qualified inbound lead to delivery, skipping outreach", async () => {
    recordFindFirst.mockResolvedValue({ id: "rec-1", status: "gathered", source: "whatsapp" });
    const result = await scoreLead({ ...base, score: 81, reasons: ["Budget fits"] });
    expect(result).toMatchObject({ status: "qualified", route: "deliver" });
  });

  it("refuses another company's lead and invalid input without writing", async () => {
    recordFindFirst.mockResolvedValue(undefined);
    expect(await scoreLead({ ...base, score: 80, reasons: ["a"] })).toEqual({
      error: "Not found",
    });
    expect(await scoreLead({ ...base, score: 30, reasons: ["a"] })).toMatchObject({
      error: expect.any(String),
    });
    expect(transitionLeadStatus).not.toHaveBeenCalled();
  });
});

// W3GAP item 1: the `deliver` route opens the lead_delivery card.
describe("scoreLead delivery card", () => {
  const inbound = () =>
    recordFindFirst.mockResolvedValue({
      id: "rec-1",
      companyId: "co-1",
      status: "gathered",
      source: "whatsapp",
    });

  it("proposes the card for a qualified inbound lead, parented on the run", async () => {
    inbound();
    const out = await scoreLead({
      ...base,
      score: 82,
      reasons: ["fit"],
      parent: { cronRunId: "run-1" },
    });
    expect(proposeLeadDelivery).toHaveBeenCalledWith({
      companyId: "co-1",
      recordId: "rec-1",
      agentId: "ag-q",
      parent: { cronRunId: "run-1" },
    });
    expect(out).toMatchObject({ route: "deliver", deliveryCheckpointId: "cp-1" });
  });

  it("proposes nothing for outbound, borderline or rejected leads", async () => {
    await scoreLead({ ...base, score: 90, reasons: ["fit"] });
    inbound();
    await scoreLead({ ...base, score: 60, reasons: ["fit"] });
    await scoreLead({ ...base, score: 20, reasons: ["fit"], rejectReason: "no" });
    expect(proposeLeadDelivery).not.toHaveBeenCalled();
  });

  it("keeps the score when the card cannot be proposed", async () => {
    inbound();
    proposeLeadDelivery.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      scoreLead({ ...base, score: 82, reasons: ["fit"] }),
    ).resolves.toMatchObject({ status: "qualified", route: "deliver" });
  });
});

describe("listLeadsToQualify", () => {
  it("applies the 24 h quiet rule against the chat's last activity", async () => {
    selectChain.rows = [
      { id: "r", name: "Ayse", source: "whatsapp", intakeComplete: false, payload: { intake: { tip: "ofis" } } },
    ];
    const now = new Date("2026-10-03T12:00:00Z");

    const rows = await listLeadsToQualify({ companyId: "co-1", now });

    expect(rows).toEqual([
      { id: "r", name: "Ayse", source: "whatsapp", intakeComplete: false, intake: { tip: "ofis" } },
    ]);
    const { sql, params } = new PgDialect().sqlToQuery(selectChain.where.mock.calls[0]![0]);
    expect(sql).toContain('"chats"."last_activity_at" <');
    expect(sql).toContain('"company_records"."intake_complete" =');
    expect(params).toContain("2026-10-02T12:00:00.000Z");
  });
});
