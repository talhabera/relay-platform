import { describe, expect, it } from "vitest";

import {
  FIRST_RESPONSE_LIMIT_MS,
  adReportWindow,
  buildAdReport,
  capacityStatus,
  firstResponseWarning,
  formatSpend,
  formatTry,
  hasAdData,
  monthCashInMinor,
  resolveLeadAttribution,
  type AdLeadRow,
  type AdMetaMapping,
  type AdReportInput,
  type AdSettings,
  type AdSpendRow,
  type AdStageEvent,
} from "./ad-report-model";

const TODAY = "2026-11-05";
const MONTH = "2026-11-01";
const NO_SETTINGS: AdSettings = {
  monthlyTargetMinor: null,
  cplStopMinor: null,
  dailyCapMinor: null,
  capacitySiteMonthly: null,
  capacitySocialMonthly: null,
};

let seq = 0;
const lead = (p: Partial<AdLeadRow> = {}): AdLeadRow => ({
  id: `r${++seq}`,
  createdOn: "2026-11-04",
  payloadKod: null,
  hasReferral: false,
  referralSourceId: null,
  linkedClickChannel: null,
  status: "gathered",
  salePackage: null,
  saleAmountMinor: null,
  firstResponseMs: null,
  payments: [],
  ...p,
});
const spend = (p: Partial<AdSpendRow> = {}): AdSpendRow => ({
  spendDate: "2026-11-04",
  channel: "google",
  campaignId: "",
  campaignName: null,
  amountMinor: 100_000,
  complete: true,
  ...p,
});
const ev = (recordId: string, toStatus: string, on: string, fromStatus: string | null = "gathered"): AdStageEvent => ({
  recordId,
  fromStatus,
  toStatus,
  on,
});
/** Every channel has a complete row on every day from 2026-10-29 to yesterday unless overridden. */
const fullSpend = (amountMinor = 100_000): AdSpendRow[] => {
  const out: AdSpendRow[] = [];
  for (const day of ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]) {
    for (const channel of ["google", "instagram", "meta"] as const) out.push(spend({ spendDate: day, channel, amountMinor }));
  }
  return out;
};
const input = (p: Partial<AdReportInput> = {}): AdReportInput => ({
  spend: [],
  leads: [],
  events: [],
  mappings: [],
  settings: NO_SETTINGS,
  today: TODAY,
  timeZone: "Europe/Istanbul",
  monthStart: MONTH,
  ...p,
});
const row = (m: ReturnType<typeof buildAdReport>, channel: string) => m.rows.find((r) => r.channel === channel)!;

describe("resolveLeadAttribution", () => {
  const mappings: AdMetaMapping[] = [
    { sourceId: "120210", code: "MWEB1", campaignName: "Site Kasim" },
    { sourceId: "120299", code: "MSOS1", campaignName: "Sosyal Kasim" },
  ];
  const attr = (p: Partial<AdLeadRow>) => resolveLeadAttribution(lead(p), mappings);

  it("reads the channel from the code prefix (G google, R instagram, M meta)", () => {
    expect(attr({ payloadKod: "G7KF3" })).toEqual({ channel: "google", campaign: null, via: "code" });
    expect(attr({ payloadKod: "R4XQ2" })).toEqual({ channel: "instagram", campaign: null, via: "code" });
    expect(attr({ payloadKod: "MWEB1" }).channel).toBe("meta");
  });

  it("lets a linked click win over the code prefix", () => {
    expect(attr({ payloadKod: "G7KF3", linkedClickChannel: "instagram" })).toEqual({
      channel: "instagram",
      campaign: null,
      via: "click",
    });
  });

  it("is unknown for organik, no code, a bad-shape code or the never-used I letter", () => {
    for (const payloadKod of ["organik", null, "g7kf3", "G7K", "I4XQ2"]) {
      expect(attr({ payloadKod })).toEqual({ channel: "unknown", campaign: null, via: "none" });
    }
  });

  it("is meta for a codeless referral; the mapping names the campaign", () => {
    expect(attr({ hasReferral: true })).toMatchObject({ channel: "meta", via: "referral" });
    expect(attr({ hasReferral: true, referralSourceId: "120210" })).toEqual({
      channel: "meta",
      campaign: "Site Kasim",
      via: "meta_mapping",
    });
    expect(attr({ hasReferral: true, referralSourceId: "999" })).toEqual({
      channel: "meta",
      campaign: "eslenmemis",
      via: "referral",
    });
  });

  it("takes the mapping's campaign for a Meta code listed in the mapping", () => {
    expect(attr({ payloadKod: "MWEB1" })).toEqual({ channel: "meta", campaign: "Site Kasim", via: "code" });
  });

  it("only uses the mapping rows it is given (already company scoped)", () => {
    expect(resolveLeadAttribution(lead({ hasReferral: true, referralSourceId: "120210" }), []).campaign).toBe(
      "eslenmemis",
    );
  });
});

describe("buildAdReport: spend and rows", () => {
  it("emits google, instagram, meta, unknown in order, even with no data", () => {
    const m = buildAdReport(input());
    expect(m.rows.map((r) => r.channel)).toEqual(["google", "instagram", "meta", "unknown"]);
    expect(row(m, "unknown")).toMatchObject({ label: "bilinmiyor" });
    expect(row(m, "unknown").month).toMatchObject({ spend: null, spendMinor: null, cplMinor: null });
  });

  it("marks a day with no row missing and a complete=false row partial", () => {
    const m = buildAdReport(input({ spend: [spend({ channel: "meta", complete: false })] }));
    expect(row(m, "google").yesterday.spend).toMatchObject({ state: "missing", minor: null });
    expect(formatSpend(row(m, "google").yesterday.spend)).toBe("girilmedi");
    expect(row(m, "meta").yesterday.spend).toMatchObject({ state: "partial", minor: 100_000 });
  });

  it("sums two campaigns on one day and channel once, and divides for cost per lead", () => {
    const m = buildAdReport(
      input({
        spend: [spend({ campaignId: "a", amountMinor: 70_000 }), spend({ campaignId: "b", amountMinor: 30_000 })],
        leads: [lead({ payloadKod: "G7KF3" }), lead({ payloadKod: "G7KF4" }), lead({ payloadKod: "G7KF5" })],
      }),
    );
    const y = row(m, "google").yesterday;
    expect(y.spend).toMatchObject({ state: "ok", minor: 100_000 });
    expect(y.leads).toBe(3);
    expect(y.cplMinor).toBe(33_333);
  });

  it("has no cost per lead with zero leads or missing spend", () => {
    const m = buildAdReport(input({ spend: [spend()], leads: [lead({ payloadKod: "R4XQ2" })] }));
    expect(row(m, "google").yesterday.cplMinor).toBeNull();
    expect(row(m, "instagram").yesterday.cplMinor).toBeNull();
  });

  it("totals only known spend and flags an incomplete span", () => {
    const m = buildAdReport(input({ spend: [spend(), spend({ channel: "meta", amountMinor: 50_000 })] }));
    expect(m.totals.yesterday.spendMinor).toBe(150_000);
    expect(m.totals.yesterday.spendComplete).toBe(false);
    const full = buildAdReport(input({ spend: fullSpend() }));
    expect(full.totals.yesterday).toMatchObject({ spendMinor: 300_000, spendComplete: true });
    expect(full.totals.month.spendMinor).toBe(1_200_000);
  });

  it("flags yesterday and the day before as immature", () => {
    expect(buildAdReport(input()).immatureDays).toEqual(["2026-11-04", "2026-11-03"]);
  });
});

describe("buildAdReport: funnel", () => {
  it("counts distinct records per stage, only inside the month, won only while still won", () => {
    const a = lead({ id: "a", payloadKod: "G7KF3" });
    const b = lead({ id: "b", payloadKod: "G7KF4", status: "won", salePackage: "website", saleAmountMinor: 4_000_000 });
    const c = lead({ id: "c", payloadKod: "G7KF5", status: "won", saleAmountMinor: 9_000_000, createdOn: "2026-10-10" });
    const m = buildAdReport(
      input({
        leads: [a, b, c],
        events: [
          ev("a", "qualified", "2026-11-02"),
          ev("a", "meeting", "2026-11-03", "qualified"),
          ev("a", "meeting", "2026-11-04", "qualified"),
          ev("b", "won", "2026-11-04", "proposal"),
          ev("c", "won", "2026-10-20", "proposal"),
          ev("c", "won", "2026-11-03", "won"), // a payment log entry, not a sale
          ev("a", "proposal", "2026-10-31", "meeting"),
        ],
      }),
    );
    expect(row(m, "google").month).toMatchObject({
      leads: 2,
      qualified: 1,
      meetings: 1,
      proposals: 0,
      won: 1,
      signedMinor: 4_000_000,
    });
  });
});

describe("cash in", () => {
  it("sums payments received in the local month only", () => {
    const payments = [
      { amountMinor: 100, receivedOn: "2026-10-31" },
      { amountMinor: 200, receivedOn: "2026-11-01" },
      { amountMinor: 400, receivedOn: "2026-11-30" },
      { amountMinor: 800, receivedOn: "2026-12-01" },
      { amountMinor: -5, receivedOn: "2026-11-02" },
    ];
    expect(monthCashInMinor(payments, MONTH, "2026-12-01")).toBe(600);
  });

  it("counts a balance on a record won last month now, and its signed amount last month", () => {
    const old = lead({
      id: "old",
      payloadKod: "G7KF3",
      status: "won",
      saleAmountMinor: 4_000_000,
      createdOn: "2026-10-01",
      payments: [
        { amountMinor: 2_000_000, receivedOn: "2026-10-05" },
        { amountMinor: 2_000_000, receivedOn: "2026-11-02" },
      ],
    });
    const fresh = lead({ id: "fresh", payloadKod: "G7KF4", status: "won", saleAmountMinor: 3_000_000 });
    const m = buildAdReport(
      input({
        leads: [old, fresh],
        events: [ev("old", "won", "2026-10-05", "proposal"), ev("fresh", "won", "2026-11-04", "proposal")],
        spend: fullSpend(),
        settings: { ...NO_SETTINGS, monthlyTargetMinor: 6_000_000 },
      }),
    );
    expect(m.cashInMinor).toBe(2_000_000);
    expect(m.totals.month.signedMinor).toBe(3_000_000);
    expect(m.target).toEqual({ signedMinor: 3_000_000, targetMinor: 6_000_000, percent: 50, barPercent: 50 });
    expect(m.cashMinusSpendMinor).toBe(2_000_000 - 1_200_000);
  });

  it("is null without any won record and cash minus spend is null without spend", () => {
    const m = buildAdReport(input({ leads: [lead()] }));
    expect(m.cashInMinor).toBeNull();
    expect(m.cashMinusSpendMinor).toBeNull();
    const won = buildAdReport(input({ leads: [lead({ status: "won" })] }));
    expect(won.cashInMinor).toBe(0);
  });
});

describe("target", () => {
  it("caps the bar at 100 but not the label, and is hidden without a target", () => {
    const b = lead({ id: "b", status: "won", saleAmountMinor: 9_000_000 });
    const events = [ev("b", "won", "2026-11-04", "proposal")];
    const m = buildAdReport(input({ leads: [b], events, settings: { ...NO_SETTINGS, monthlyTargetMinor: 6_000_000 } }));
    expect(m.target).toMatchObject({ percent: 150, barPercent: 100 });
    expect(buildAdReport(input({ leads: [b], events })).target).toBeNull();
  });
});

describe("first response", () => {
  const rows = [
    ...[61_000, 85_000, 120_000].map((ms) => lead({ firstResponseMs: ms, createdOn: "2026-11-03" })),
    ...Array.from({ length: 11 }, () => lead({ firstResponseMs: 90_000, createdOn: "2026-11-01" })),
    lead({ firstResponseMs: FIRST_RESPONSE_LIMIT_MS, createdOn: "2026-11-02" }),
    lead({ firstResponseMs: null }),
    lead({ firstResponseMs: 500_000, createdOn: "2026-10-29" }),
  ];

  it("counts over 60 s as late, 60 s exactly on time, unmeasured not at all, last 7 days only", () => {
    // 15 measured: 14 over (3 + 11) and the exact 60 s one; the 10-29 lead is outside.
    expect(firstResponseWarning(rows, TODAY)?.text).toBe("Ilk yanit 60 sn ustu: 14 / 15 basvuru, ortanca 90 sn");
  });

  it("matches the spec copy and is absent when nothing is late or measured", () => {
    const three = [
      ...[85_000, 90_000, 70_000].map((ms) => lead({ firstResponseMs: ms })),
      ...Array.from({ length: 11 }, () => lead({ firstResponseMs: 30_000 })),
    ];
    expect(firstResponseWarning(three, TODAY)?.text).toBe("Ilk yanit 60 sn ustu: 3 / 14 basvuru, ortanca 30 sn");
    expect(firstResponseWarning([lead({ firstResponseMs: 60_000 })], TODAY)).toBeNull();
    expect(firstResponseWarning([lead()], TODAY)).toBeNull();
  });
});

describe("capacity", () => {
  const settings = { capacitySiteMonthly: 2, capacitySocialMonthly: null };
  it("warns only when full; null means no rule; 0 means not taking", () => {
    expect(capacityStatus({ website: 2, social: 5 }, settings).warnings.map((w) => w.text)).toEqual([
      "Site kapasitesi dolu: 2 / 2",
    ]);
    expect(capacityStatus({ website: 1, social: 0 }, settings).warnings).toEqual([]);
    expect(capacityStatus({ website: 1, social: 0 }, settings).capacity.social).toEqual({
      won: 0,
      capacity: null,
      full: false,
    });
    expect(
      capacityStatus({ website: 0, social: 0 }, { capacitySiteMonthly: 0, capacitySocialMonthly: null }).warnings[0].text,
    ).toBe("Site bu ay alinmiyor");
  });

  it("counts won this month and still won, per package", () => {
    const m = buildAdReport(
      input({
        leads: [
          lead({ id: "s1", status: "won", salePackage: "website" }),
          lead({ id: "s2", status: "won", salePackage: "website" }),
          lead({ id: "s3", status: "won", salePackage: "website" }),
          lead({ id: "s4", status: "unqualified", salePackage: "website" }),
        ],
        events: [
          ev("s1", "won", "2026-11-02", "proposal"),
          ev("s2", "won", "2026-11-03", "proposal"),
          ev("s3", "won", "2026-10-30", "proposal"),
          ev("s4", "won", "2026-11-02", "proposal"),
        ],
        settings: { ...NO_SETTINGS, capacitySiteMonthly: 2, capacitySocialMonthly: 3 },
      }),
    );
    expect(m.capacity.website).toEqual({ won: 2, capacity: 2, full: true });
    expect(m.capacity.social).toEqual({ won: 0, capacity: 3, full: false });
    expect(m.warnings.map((w) => w.text)).toContain("Site kapasitesi dolu: 2 / 2");
  });
});

describe("warnings", () => {
  it("warns on CPL over the threshold, needs at least one lead, none without a setting", () => {
    const leads = [lead({ payloadKod: "MWEB1" })];
    const settings = { ...NO_SETTINGS, cplStopMinor: 80_000 };
    const m = buildAdReport(input({ spend: fullSpend(), leads, settings }));
    expect(m.warnings[0]).toEqual({
      kind: "cpl",
      channel: "meta",
      text: "Meta WhatsApp: basvuru basi maliyet 4.000 TL, esik 800 TL",
    });
    expect(buildAdReport(input({ spend: fullSpend(), leads })).warnings.some((w) => w.kind === "cpl")).toBe(false);
  });

  it("warns on no leads for 7 days on a channel that spent, naming the days", () => {
    const m = buildAdReport(input({ spend: fullSpend(), leads: [lead({ payloadKod: "R4XQ2", createdOn: "2026-10-27" })] }));
    expect(m.warnings.map((w) => w.text)).toContain("Instagram geri: 9 gundur basvuru yok");
    const recent = buildAdReport(input({ spend: fullSpend(), leads: [lead({ payloadKod: "R4XQ2", createdOn: "2026-11-01" })] }));
    expect(recent.warnings.some((w) => w.kind === "no_leads" && w.channel === "instagram")).toBe(false);
  });

  it("warns on a missing spend day in the last 7 completed days", () => {
    const m = buildAdReport(input({ spend: fullSpend().filter((r) => !(r.spendDate === "2026-11-03" && r.channel === "google")) }));
    expect(m.warnings.find((w) => w.kind === "missing_data")?.text).toBe("3 Kasim icin harcama girilmedi");
    expect(buildAdReport(input({ spend: fullSpend() })).warnings.some((w) => w.kind === "missing_data")).toBe(false);
  });

  it("warns on a daily total above the cap on a day with data", () => {
    const settings = { ...NO_SETTINGS, dailyCapMinor: 250_000 };
    const m = buildAdReport(input({ spend: fullSpend(), settings }));
    expect(m.warnings.find((w) => w.kind === "daily_cap")?.text).toBe("4 Kasim: gunluk harcama 3.000 TL, tavan 2.500 TL");
    expect(buildAdReport(input({ spend: fullSpend() })).warnings.some((w) => w.kind === "daily_cap")).toBe(false);
  });

  it("orders CPL, capacity, first response, missing data, no leads; caps at 5; counts unmapped Meta", () => {
    const m = buildAdReport(
      input({
        spend: fullSpend().filter((r) => r.spendDate !== "2026-11-04" || r.channel !== "google"),
        leads: [
          lead({ id: "w", payloadKod: "MWEB1", status: "won", salePackage: "website", firstResponseMs: 90_000 }),
          ...Array.from({ length: 4 }, () => lead({ hasReferral: true, referralSourceId: "x" })),
        ],
        events: [ev("w", "won", "2026-11-04", "proposal")],
        settings: { ...NO_SETTINGS, cplStopMinor: 1_000, capacitySiteMonthly: 1 },
      }),
    );
    expect(m.warnings).toHaveLength(5);
    expect(m.warnings.map((w) => w.kind)).toEqual(["cpl", "capacity", "first_response", "missing_data", "no_leads"]);
    const unmapped = buildAdReport(input({ leads: Array.from({ length: 4 }, () => lead({ hasReferral: true })) }));
    expect(unmapped.warnings.map((w) => w.text)).toContain("Meta: 4 basvuru kampanyaya eslenmedi");
    expect(unmapped.metaCampaigns).toEqual([
      { campaign: "eslenmemis", leads: 4, qualified: 0, won: 0, signedMinor: 0, spend: null },
    ]);
  });
});

describe("formatting and empty state", () => {
  it("formats minor units as whole TL with a thousands dot", () => {
    expect(formatTry(0)).toBe("0 TL");
    expect(formatTry(123_456_700)).toBe("1.234.567 TL");
    expect(formatTry(null)).toBe("-");
    expect(formatTry(-50_000)).toBe("-500 TL");
  });

  it("has no ad data without spend, settings, mappings or attributed leads", () => {
    expect(hasAdData(input({ leads: [lead()] }))).toBe(false);
    expect(hasAdData(input({ leads: [lead({ payloadKod: "G7KF3" })] }))).toBe(true);
    expect(hasAdData(input({ settings: { ...NO_SETTINGS, cplStopMinor: 1 } }))).toBe(true);
  });

  it("reads back over the month start for yesterday and the last 7 days", () => {
    expect(adReportWindow("2026-11-01")).toEqual({
      monthStart: "2026-11-01",
      windowStart: "2026-10-25",
      leadSince: "2026-10-02",
    });
    expect(adReportWindow("2026-11-20").windowStart).toBe("2026-11-01");
  });
});
