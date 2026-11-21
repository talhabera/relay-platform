import { describe, expect, it } from "vitest";
import {
  loadLeadsByChannelDay,
  loadWonByPackageThisMonth,
  type AdLeadRawRow,
  type AdLeadStore,
  type AdWonEventRow,
} from "./ad-leads";

const COMPANY = "company-a";
const OTHER = "company-b";
const IST = "Europe/Istanbul";

/** A store double holding rows for two companies; it records every company id it is asked for. */
function storeDouble(
  leads: Array<AdLeadRawRow & { companyId: string }>,
  won: Array<AdWonEventRow & { companyId: string }> = [],
) {
  const asked: string[] = [];
  const store: AdLeadStore = {
    leadRows: async (companyId, from, to) => {
      asked.push(companyId);
      return leads.filter((l) => l.companyId === companyId && l.createdAt >= from && l.createdAt < to);
    },
    wonEvents: async (companyId, since) => {
      asked.push(companyId);
      return won.filter((w) => w.companyId === companyId && w.at >= since);
    },
  };
  return { store, asked };
}

const lead = (id: string, at: string, overrides: Partial<AdLeadRawRow & { companyId: string }> = {}) => ({
  id,
  companyId: COMPANY,
  createdAt: new Date(at),
  kod: "organik",
  referral: null,
  clickChannel: null,
  ...overrides,
});

const FROM = new Date("2026-11-01T00:00:00Z");
const TO = new Date("2026-11-30T00:00:00Z");

describe("loadLeadsByChannelDay", () => {
  it("attributes by linked click, then Meta referral, else unknown, scoped to the company", async () => {
    const { store, asked } = storeDouble([
      lead("g", "2026-11-03T09:00:00Z", { kod: "GABCD", clickChannel: "google" }),
      lead("m", "2026-11-03T10:00:00Z", { kod: null, referral: { sourceId: "120201" } }),
      lead("u", "2026-11-03T11:00:00Z"),
      lead("x", "2026-11-03T12:00:00Z", { companyId: OTHER, clickChannel: "google" }),
    ]);
    const result = await loadLeadsByChannelDay(COMPANY, FROM, TO, { timeZone: IST, store });
    expect(result).toEqual({
      google: { "2026-11-03": 1 },
      instagram: {},
      meta: { "2026-11-03": 1 },
      unknown: { "2026-11-03": 1 },
    });
    expect(asked).toEqual([COMPANY]);
  });

  it("buckets by the Istanbul day: 22:30 UTC on the 4th is the 5th", async () => {
    const { store } = storeDouble([lead("g", "2026-11-04T22:30:00Z", { clickChannel: "google" })]);
    const result = await loadLeadsByChannelDay(COMPANY, FROM, TO, { timeZone: IST, store });
    expect(result.google).toEqual({ "2026-11-05": 1 });
  });
});

describe("loadWonByPackageThisMonth", () => {
  const won = (recordId: string, at: string, overrides: Partial<AdWonEventRow & { companyId: string }> = {}) => ({
    recordId,
    companyId: COMPANY,
    status: "won",
    salePackage: "website" as const,
    at: new Date(at),
    ...overrides,
  });

  it("counts a record once, drops a re-opened one and flags a full package", async () => {
    const { store, asked } = storeDouble(
      [],
      [
        won("r1", "2026-11-02T09:00:00Z"),
        won("r1", "2026-11-05T09:00:00Z"),
        won("r2", "2026-11-06T09:00:00Z"),
        won("r3", "2026-11-07T09:00:00Z", { status: "proposal" }),
        won("r4", "2026-11-07T09:00:00Z", { salePackage: "social" }),
        won("r5", "2026-10-30T09:00:00Z"),
        won("r6", "2026-11-07T09:00:00Z", { companyId: OTHER }),
      ],
    );
    const result = await loadWonByPackageThisMonth(COMPANY, "2026-11-01", {
      timeZone: IST,
      limits: { site: 2, social: null },
      store,
    });
    expect(result).toEqual({
      site: { won: 2, limit: 2, full: true },
      social: { won: 1, limit: null, full: false },
    });
    expect(asked).toEqual([COMPANY]);
  });
});
