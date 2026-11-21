import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { db } from "@/db";
import { adSpendDaily, companies } from "@/db/schema";

import { DEFAULT_DAILY_CAP_MINOR, getDailyCap, listSpendForMonth, upsertSpendRows } from "./spend-queries";

type MockedDb = {
  select: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
};
const mockedDb = db as unknown as MockedDb;
const dialect = new PgDialect();

/** Chainable select builder that records `where` and resolves to `rows`. */
function selectChain(rows: unknown[], seen: { where?: SQL; from?: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.from = vi.fn((table: unknown) => {
    seen.from = table;
    return builder;
  });
  builder.where = vi.fn((where: SQL) => {
    seen.where = where;
    return builder;
  });
  builder.limit = vi.fn(() => builder);
  builder.then = (resolve: (value: unknown[]) => unknown) => resolve(rows);
  return builder;
}

/** Fake transaction: select returns `existing`; insert records values and conflict config. */
function fakeTx(existing: unknown[]) {
  const inserts: { values: unknown[]; conflict: Record<string, unknown> }[] = [];
  const tx = {
    select: vi.fn(() => selectChain(existing, {})),
    insert: vi.fn((table: unknown) => {
      expect(table).toBe(adSpendDaily);
      return {
        values: vi.fn((values: unknown[]) => ({
          onConflictDoUpdate: vi.fn(async (conflict: Record<string, unknown>) => {
            inserts.push({ values, conflict });
          }),
        })),
      };
    }),
  };
  mockedDb.transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
  return { tx, inserts };
}

beforeEach(() => {
  mockedDb.select = vi.fn();
});

describe("upsertSpendRows", () => {
  const rows = [
    { date: "2026-11-04", channel: "google" as const, amountMinor: 46700 },
    { date: "2026-11-04", channel: "meta" as const, amountMinor: 0 },
  ];

  it("inserts with ON CONFLICT (company, date, channel, campaign) DO UPDATE so re-entry overwrites", async () => {
    const { inserts } = fakeTx([{ date: "2026-11-04", channel: "google", campaignId: "", source: "manual" }]);
    const result = await upsertSpendRows({ companyId: "c1", rows, source: "manual" });

    expect(mockedDb.transaction).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    const { values, conflict } = inserts[0];
    expect(conflict.target).toEqual([
      adSpendDaily.companyId,
      adSpendDaily.spendDate,
      adSpendDaily.channel,
      adSpendDaily.campaignId,
    ]);
    expect(Object.keys(conflict.set as object)).toEqual(
      expect.arrayContaining(["amountMinor", "source", "updatedAt"]),
    );
    expect(dialect.sqlToQuery(conflict.setWhere as SQL).sql).toContain("<> 'api'");
    expect(values).toEqual([
      expect.objectContaining({ companyId: "c1", spendDate: "2026-11-04", channel: "google", campaignId: "", amountMinor: 46700, source: "manual" }),
      expect.objectContaining({ companyId: "c1", channel: "meta", amountMinor: 0, source: "manual" }),
    ]);
    expect(result).toEqual({ written: 2, overwritten: 1, skippedApi: 0, apiConflicts: [] });
  });

  it("refuses to replace an api row and returns the conflict", async () => {
    const { inserts } = fakeTx([{ date: "2026-11-04", channel: "google", campaignId: "", source: "api" }]);
    const result = await upsertSpendRows({ companyId: "c1", rows, source: "csv" });

    expect(result).toEqual({
      written: 1,
      overwritten: 0,
      skippedApi: 1,
      apiConflicts: [{ date: "2026-11-04", channel: "google", campaignId: "" }],
    });
    expect(inserts[0].values).toEqual([expect.objectContaining({ channel: "meta", source: "csv" })]);
  });

  it("replaces an api row when allowOverApi is true", async () => {
    const { inserts } = fakeTx([{ date: "2026-11-04", channel: "google", campaignId: "", source: "api" }]);
    const result = await upsertSpendRows({ companyId: "c1", rows, source: "manual", allowOverApi: true });

    expect(result).toEqual({ written: 2, overwritten: 1, skippedApi: 0, apiConflicts: [] });
    expect(inserts[0].conflict.setWhere).toBeUndefined();
  });

  it("writes nothing and opens no transaction for no rows", async () => {
    fakeTx([]);
    expect(await upsertSpendRows({ companyId: "c1", rows: [], source: "csv" })).toEqual({
      written: 0,
      overwritten: 0,
      skippedApi: 0,
      apiConflicts: [],
    });
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });
});

describe("listSpendForMonth", () => {
  it("filters by the given company and the month's date range", async () => {
    const seen: { where?: SQL; from?: unknown } = {};
    mockedDb.select = vi.fn(() => selectChain([], seen));
    await listSpendForMonth("company-a", "2026-11");

    expect(seen.from).toBe(adSpendDaily);
    const query = dialect.sqlToQuery(seen.where as SQL);
    expect(query.sql).toContain('"ad_spend_daily"."company_id" = $1');
    expect(query.params).toEqual(["company-a", "2026-11-01", "2026-11-30"]);
  });
});

describe("getDailyCap", () => {
  it("reads the company setting", async () => {
    const seen: { where?: SQL; from?: unknown } = {};
    mockedDb.select = vi.fn(() => selectChain([{ capMinor: 75000 }], seen));
    expect(await getDailyCap("company-a")).toBe(75000);
    expect(seen.from).toBe(companies);
  });

  it("falls back to 1.000 TL only when the setting is unset", async () => {
    mockedDb.select = vi.fn(() => selectChain([{ capMinor: null }], {}));
    expect(await getDailyCap("company-a")).toBe(DEFAULT_DAILY_CAP_MINOR);
    mockedDb.select = vi.fn(() => selectChain([{ capMinor: 0 }], {}));
    expect(await getDailyCap("company-a")).toBe(0);
  });
});
