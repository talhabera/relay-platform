import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import { leadEvents } from "@/db/schema";

import {
  addLeadPayment,
  paidMinor,
  PAYMENT_KIND_BY_PACKAGE,
  readLeadPayments,
  removeLeadPayment,
  type LeadPayment,
} from "./payments";

const AT = new Date("2026-11-06T10:00:00Z");
const base = { companyId: "co-1", leadId: "lead-1", userId: "u-1", at: AT };

const deposit: LeadPayment = {
  id: "p-1",
  kind: "deposit",
  amountMinor: 4_000_000,
  receivedOn: "2026-11-01",
  recordedBy: "u-1",
  recordedAt: "2026-11-01T09:00:00.000Z",
};

type Row = {
  status: string;
  salePackage: string | null;
  saleAmountMinor: number | null;
  payload: Record<string, unknown>;
  timeZone: string;
};

let row: Row | undefined;
let updated: unknown[];
const set = vi.fn();
const where = vi.fn();
/** Every `tx.insert(table).values(v)`; only lead events are inserted here. */
const insertLeadEvent = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  row = {
    status: "won",
    salePackage: "website",
    saleAmountMinor: 8_000_000,
    payload: { intake: { tip: "ofis" } },
    timeZone: "Europe/Istanbul",
  };
  updated = [{ id: "lead-1" }];
  const chain: Record<string, unknown> = {};
  for (const key of ["from", "innerJoin", "where"]) chain[key] = () => chain;
  chain.for = async () => (row ? [row] : []);
  const tx = {
    select: () => chain,
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        expect(table).toBe(leadEvents);
        insertLeadEvent(values);
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        set(values);
        return {
          where: (cond: unknown) => {
            where(cond);
            return { returning: async () => updated };
          },
        };
      },
    }),
  };
  (db as unknown as { transaction: unknown }).transaction = async (fn: (t: unknown) => unknown) => fn(tx);
});

function render(fragment: unknown) {
  return new PgDialect().sqlToQuery(fragment as SQL);
}

describe("addLeadPayment", () => {
  const add = { ...base, kind: "deposit" as const, amountMinor: 4_000_000, receivedOn: "2026-11-05" };

  it("appends one entry with one atomic jsonb append and audits it", async () => {
    const result = await addLeadPayment(add);
    expect(result).toMatchObject({ ok: true, payment: { kind: "deposit", amountMinor: 4_000_000, receivedOn: "2026-11-05", recordedBy: "u-1", recordedAt: AT.toISOString() } });

    expect(set).toHaveBeenCalledTimes(1);
    const values = set.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(values).sort()).toEqual(["payload", "updatedAt"]);
    const payloadSql = render(values.payload);
    expect(payloadSql.sql).toContain("jsonb_set");
    expect(payloadSql.sql).toContain("||");
    // The append carries only the new entry, never the whole payload.
    const appended = JSON.parse(payloadSql.params.find((p) => typeof p === "string" && p.startsWith("[")) as string);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ kind: "deposit", amountMinor: 4_000_000 });
    expect(JSON.stringify(payloadSql.params)).not.toContain("ofis");

    const guard = render(where.mock.calls[0]![0]);
    expect(guard.sql).toContain(`"status" = $`);
    expect(guard.params).toContain("won");

    expect(insertLeadEvent).toHaveBeenCalledTimes(1);
    const paymentId = appended[0].id as string;
    expect(insertLeadEvent).toHaveBeenCalledWith({
      companyId: "co-1",
      recordId: "lead-1",
      fromStatus: "won",
      toStatus: "won",
      agentId: null,
      userId: "u-1",
      at: AT,
      metadata: { op: "payment_add", paymentId, kind: "deposit" },
    });
  });

  it("refuses a lead that is not won", async () => {
    row!.status = "proposal";
    await expect(addLeadPayment(add)).resolves.toEqual({ ok: false, reason: "not_won" });
    expect(set).not.toHaveBeenCalled();
    expect(insertLeadEvent).not.toHaveBeenCalled();
  });

  it("refuses a missing lead", async () => {
    row = undefined;
    await expect(addLeadPayment(add)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a kind that does not fit the package", async () => {
    row!.salePackage = "social";
    await expect(addLeadPayment(add)).resolves.toEqual({ ok: false, reason: "kind_mismatch" });
    row!.salePackage = "website";
    await expect(addLeadPayment({ ...add, kind: "monthly" })).resolves.toEqual({ ok: false, reason: "kind_mismatch" });
    expect(set).not.toHaveBeenCalled();
  });

  it("refuses a non-positive or non-integer amount", async () => {
    for (const amountMinor of [0, -100, 12.5, Number.NaN]) {
      await expect(addLeadPayment({ ...add, amountMinor })).resolves.toEqual({ ok: false, reason: "invalid_amount" });
    }
    expect(set).not.toHaveBeenCalled();
  });

  it("refuses a malformed or future receivedOn (company-local today)", async () => {
    for (const receivedOn of ["2026-13-01", "2026-02-30", "05.11.2026", "2026-11-07", ""]) {
      await expect(addLeadPayment({ ...add, receivedOn })).resolves.toEqual({ ok: false, reason: "invalid_date" });
    }
    // 2026-11-06 is today in Istanbul at 10:00 UTC.
    await expect(addLeadPayment({ ...add, receivedOn: "2026-11-06" })).resolves.toMatchObject({ ok: true });
  });

  it("website: deposit plus balance may not exceed the sale amount", async () => {
    row!.payload = { payments: [deposit] };
    await expect(addLeadPayment({ ...add, kind: "balance", amountMinor: 4_000_001 })).resolves.toEqual({
      ok: false,
      reason: "exceeds_sale",
    });
    await expect(addLeadPayment({ ...add, kind: "balance", amountMinor: 4_000_000 })).resolves.toMatchObject({ ok: true });
  });

  it("social: setup and monthly are not capped by the sale amount", async () => {
    row = { ...row!, salePackage: "social", saleAmountMinor: 2_500_000 };
    await expect(
      addLeadPayment({ ...add, kind: "monthly", amountMinor: 4_500_000 }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("refuses when the guarded update matched nothing (no longer won)", async () => {
    updated = [];
    await expect(addLeadPayment(add)).resolves.toEqual({ ok: false, reason: "not_won" });
    expect(insertLeadEvent).not.toHaveBeenCalled();
  });
});

describe("removeLeadPayment", () => {
  const remove = { ...base, paymentId: "p-1" };

  it("removes by id on a won lead with an atomic jsonb removal and audits it", async () => {
    row!.payload = { payments: [deposit], intake: { tip: "ofis" } };
    await expect(removeLeadPayment(remove)).resolves.toEqual({ ok: true, payment: deposit });

    const values = set.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(values).sort()).toEqual(["payload", "updatedAt"]);
    const payloadSql = render(values.payload);
    expect(payloadSql.sql).toContain("jsonb_set");
    expect(payloadSql.sql).toContain("jsonb_array_elements");
    expect(payloadSql.params).toContain("p-1");
    expect(JSON.stringify(payloadSql.params)).not.toContain("ofis");
    expect(render(where.mock.calls[0]![0]).params).toContain("won");

    expect(insertLeadEvent).toHaveBeenCalledTimes(1);
    expect(insertLeadEvent).toHaveBeenCalledWith({
      companyId: "co-1",
      recordId: "lead-1",
      fromStatus: "won",
      toStatus: "won",
      agentId: null,
      userId: "u-1",
      at: AT,
      metadata: { op: "payment_remove", paymentId: "p-1", kind: "deposit" },
    });
  });

  it("refuses a lead that is not won, and an unknown payment id", async () => {
    row!.payload = { payments: [deposit] };
    row!.status = "meeting";
    await expect(removeLeadPayment(remove)).resolves.toEqual({ ok: false, reason: "not_won" });
    row!.status = "won";
    await expect(removeLeadPayment({ ...remove, paymentId: "nope" })).resolves.toEqual({ ok: false, reason: "not_found" });
    expect(set).not.toHaveBeenCalled();
    expect(insertLeadEvent).not.toHaveBeenCalled();
  });
});

describe("readLeadPayments / paidMinor", () => {
  it("returns typed entries sorted by receivedOn, dropping malformed ones", () => {
    const balance: LeadPayment = { ...deposit, id: "p-2", kind: "balance", receivedOn: "2026-12-20" };
    const list = readLeadPayments({
      payments: [
        balance,
        { ...deposit, amountMinor: -1 },
        { ...deposit, kind: "tip" },
        { ...deposit, receivedOn: "yesterday" },
        { ...deposit, id: "" },
        "junk",
        null,
        deposit,
      ],
    });
    expect(list).toEqual([deposit, balance]);
    expect(paidMinor(list)).toBe(8_000_000);
  });

  it("returns [] for a payload without payments", () => {
    expect(readLeadPayments({})).toEqual([]);
    expect(readLeadPayments(null)).toEqual([]);
    expect(readLeadPayments({ payments: { id: "x" } })).toEqual([]);
    expect(paidMinor([])).toBe(0);
  });

  it("maps kinds to packages", () => {
    expect(PAYMENT_KIND_BY_PACKAGE).toEqual({ website: ["deposit", "balance"], social: ["setup", "monthly"] });
  });
});
