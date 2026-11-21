import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";

const { transitionLeadStatus, emitPortalEvent } = vi.hoisted(() => ({
  transitionLeadStatus: vi.fn(),
  emitPortalEvent: vi.fn(),
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return { ...actual, transitionLeadStatus };
});
vi.mock("@/lib/live/portal-events", () => ({ emitPortalEvent }));

import {
  markLeadDelivered,
  qualifiedLeadsToCsv,
  QUALIFIED_CSV_COLUMNS,
  type QualifiedLead,
} from ".";

const tx = {
  select: vi.fn(() => ({
    from: () => ({
      where: () => Promise.resolve([{ name: "Ayse", source: "whatsapp" }]),
    }),
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
  (db as unknown as Record<string, unknown>).transaction = vi.fn(
    async (fn: (t: typeof tx) => unknown) => fn(tx),
  );
  transitionLeadStatus.mockResolvedValue({ changed: true, event: { id: "ev" } });
  emitPortalEvent.mockResolvedValue({ id: "pe" });
});

describe("markLeadDelivered", () => {
  const at = new Date("2026-10-05T09:00:00Z");

  it("logs delivered, stamps first delivery and posts to the Live feed in one transaction", async () => {
    await expect(
      markLeadDelivered({ companyId: "co-1", leadId: "lead-1", userId: "u-1", at }),
    ).resolves.toEqual({ delivered: true });

    expect(transitionLeadStatus).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        companyId: "co-1",
        recordId: "lead-1",
        toStatus: "delivered",
        actor: { userId: "u-1" },
        at,
        set: { firstDeliveredAt: expect.anything() },
      }),
    );
    expect(emitPortalEvent).toHaveBeenCalledWith(tx, {
      companyId: "co-1",
      type: "lead_delivered",
      title: "Lead delivered: Ayse",
      channel: "whatsapp",
      refId: "lead-1",
      at,
    });
  });

  it("posts nothing for a lead already delivered", async () => {
    transitionLeadStatus.mockResolvedValue({ changed: false, reason: "same_status" });
    await expect(
      markLeadDelivered({ companyId: "co-1", leadId: "lead-1", userId: "u-1", at }),
    ).resolves.toEqual({ delivered: false, reason: "already_delivered" });
    expect(emitPortalEvent).not.toHaveBeenCalled();
  });

  // W3GAP item 7: a rejected or gathered lead never becomes delivered.
  it("only moves a qualified, interested or delivered lead", async () => {
    await markLeadDelivered({ companyId: "co-1", leadId: "lead-1", userId: "u-1", at });
    const guard = transitionLeadStatus.mock.calls[0][1].guard as SQL | undefined;
    expect(guard).toBeDefined();
    const rendered = new PgDialect().sqlToQuery(guard!);
    expect(rendered.params).toEqual(["qualified", "interested", "delivered"]);
  });

  it("reports a lead in any other status as not deliverable", async () => {
    transitionLeadStatus.mockResolvedValue({ changed: false, reason: "guard_failed" });
    await expect(
      markLeadDelivered({ companyId: "co-1", leadId: "lead-1", userId: "u-1", at }),
    ).resolves.toEqual({ delivered: false, reason: "not_deliverable" });
    expect(emitPortalEvent).not.toHaveBeenCalled();
  });
});

describe("qualifiedLeadsToCsv", () => {
  const lead: QualifiedLead = {
    id: "lead-1",
    name: "=Ayse",
    phone: "+905551112233",
    source: "whatsapp",
    status: "delivered",
    fitScore: null,
    intake: { tip: "villa", m2: "120", kod: "K1", skor: 30 },
    qualifiedAt: new Date("2026-09-01T10:00:00Z"),
    firstDeliveredAt: null,
    createdAt: new Date("2026-09-01T09:00:00Z"),
  };

  it("writes a BOM, the fixed header and intake columns, formula-escaped", () => {
    const csv = qualifiedLeadsToCsv([lead]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [header, row] = csv.slice(1).split("\r\n");
    expect(header).toBe(QUALIFIED_CSV_COLUMNS.join(","));
    expect(row).toBe(
      "lead-1,'=Ayse,'+905551112233,whatsapp,,delivered,K1,villa,120,,,,2026-09-01T10:00:00.000Z,,2026-09-01T09:00:00.000Z",
    );
  });
});
