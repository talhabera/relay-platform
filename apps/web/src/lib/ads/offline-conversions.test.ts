// Offline conversion export (RELAY-169). The pure helpers and reducers carry
// the logic and are tested on in-memory rows. `loadOfflineConversions` runs
// through the real drizzle postgres-js driver over a fake `postgres` client
// (pattern of analytics/_overview/load-overview.test.ts): the fake can show
// that the company and the range go out as bound parameters, that only SELECTs
// run and that the returned rows reach `selectConversions`. It cannot check SQL
// semantics; the first-qualified / latest-won logic is covered by the reducers
// below and the real SQL by the manual seed check of the dispatch (Step 6).
// The repo has no database-backed test harness, so none is added here.
import { drizzle } from "drizzle-orm/postgres-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

import {
  CONVERSION_QUALIFIED,
  CONVERSION_WON,
  buildOfflineConversionsCsv,
  firstQualifiedAt,
  formatConversionTime,
  formatMinorAsLira,
  isExportableClickId,
  latestWonAt,
  loadOfflineConversions,
  pickClickId,
  resolveExportRange,
  selectConversions,
  type ConversionClick,
  type ConversionEvent,
  type ConversionRecord,
  type OfflineConversionRow,
} from "./offline-conversions";

vi.mock("@/db", () => ({ db: null }));

const TZ = "Europe/Istanbul";
const HEADER =
  "Parameters:TimeZone=Europe/Istanbul\r\n" +
  "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID\r\n";

describe("formatConversionTime", () => {
  it("writes yyyy-MM-dd HH:mm:ss in the company zone without an offset", () => {
    expect(formatConversionTime(new Date("2026-11-05T12:42:01Z"), TZ)).toBe("2026-11-05 15:42:01");
  });

  it("uses UTC+3 in winter and in summer (Istanbul has no DST)", () => {
    expect(formatConversionTime(new Date("2026-01-15T21:30:00Z"), TZ)).toBe("2026-01-16 00:30:00");
    expect(formatConversionTime(new Date("2026-07-15T21:30:00Z"), TZ)).toBe("2026-07-16 00:30:00");
  });

  it("writes midnight as 00, not 24", () => {
    expect(formatConversionTime(new Date("2026-11-04T21:00:00Z"), TZ)).toBe("2026-11-05 00:00:00");
  });
});

describe("formatMinorAsLira", () => {
  it("formats kuruş with a decimal point and no thousands separator", () => {
    expect(formatMinorAsLira(8_000_000)).toBe("80000.00");
    expect(formatMinorAsLira(5)).toBe("0.05");
    expect(formatMinorAsLira(0)).toBe("0.00");
    expect(formatMinorAsLira(123_456_789)).toBe("1234567.89");
  });

  it("refuses a non-integer amount", () => {
    expect(() => formatMinorAsLira(1.5)).toThrow();
  });
});

describe("isExportableClickId", () => {
  it("accepts Google click id characters, including a leading - or _", () => {
    expect(isExportableClickId("Cj0KCQ-abc_123")).toBe(true);
    expect(isExportableClickId("-abc")).toBe(true);
    expect(isExportableClickId("_abc")).toBe(true);
    expect(isExportableClickId("a".repeat(200))).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["201 chars", "a".repeat(201)],
    ["space", "abc def"],
    ["comma", "abc,def"],
    ["quote", 'abc"def'],
    ["newline", "abc\ndef"],
    ["trailing newline", "abc\n"],
    ["equals", "=cmd"],
  ])("rejects %s", (_label, value) => {
    expect(isExportableClickId(value)).toBe(false);
  });
});

describe("pickClickId", () => {
  it("prefers gclid, then gbraid", () => {
    expect(pickClickId({ gclid: "G1", gbraid: "B1", wbraid: "W1" })).toEqual({ kind: "gclid", value: "G1" });
    expect(pickClickId({ gclid: null, gbraid: "B1", wbraid: "W1" })).toEqual({ kind: "gbraid", value: "B1" });
    expect(pickClickId({ gclid: "", gbraid: "B1", wbraid: null })).toEqual({ kind: "gbraid", value: "B1" });
  });

  it("reports a wbraid-only click and returns null when there is no id", () => {
    expect(pickClickId({ gclid: null, gbraid: null, wbraid: "W1" })).toEqual({ kind: "wbraid_only" });
    expect(pickClickId({ gclid: null, gbraid: null, wbraid: null })).toBeNull();
  });
});

describe("buildOfflineConversionsCsv", () => {
  const rows: OfflineConversionRow[] = [
    {
      clickId: "Cj0KCQ-won",
      name: CONVERSION_WON,
      at: new Date("2026-11-05T12:00:00Z"),
      valueMinor: 8_000_000,
      orderId: "rec-1:won",
    },
    {
      clickId: "Cj0KCQ-q2",
      name: CONVERSION_QUALIFIED,
      at: new Date("2026-11-05T12:00:00Z"),
      valueMinor: 0,
      orderId: "rec-2:qualified",
    },
    {
      clickId: "-early",
      name: CONVERSION_QUALIFIED,
      at: new Date("2026-11-04T08:00:00Z"),
      valueMinor: 0,
      orderId: "rec-1:qualified",
    },
  ];

  it("writes the parameters line, the English header and CRLF rows ordered by time then name", () => {
    expect(buildOfflineConversionsCsv({ timeZone: TZ, rows })).toBe(
      HEADER +
        "-early,Nitelikli başvuru,2026-11-04 11:00:00,0.00,TRY,rec-1:qualified\r\n" +
        "Cj0KCQ-q2,Nitelikli başvuru,2026-11-05 15:00:00,0.00,TRY,rec-2:qualified\r\n" +
        "Cj0KCQ-won,Satış,2026-11-05 15:00:00,80000.00,TRY,rec-1:won\r\n",
    );
  });

  it("has no BOM and ends with exactly one CRLF", () => {
    const csv = buildOfflineConversionsCsv({ timeZone: TZ, rows });
    const bytes = new TextEncoder().encode(csv);
    expect(Array.from(bytes.slice(0, 3))).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.startsWith("Parameters:")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.endsWith("\r\n\r\n")).toBe(false);
  });

  it("keeps the conversion names byte-identical to the Google Ads actions", () => {
    expect(CONVERSION_QUALIFIED).toBe("Nitelikli başvuru");
    expect(CONVERSION_WON).toBe("Satış");
  });

  it("returns the two header lines for an empty range", () => {
    expect(buildOfflineConversionsCsv({ timeZone: TZ, rows: [] })).toBe(HEADER);
  });

  it("refuses a click id that would not be a safe CSV cell", () => {
    expect(() =>
      buildOfflineConversionsCsv({ timeZone: TZ, rows: [{ ...rows[0], clickId: "=HYPERLINK(1)" }] }),
    ).toThrow();
  });
});

const ev = (recordId: string, toStatus: string, at: string): ConversionEvent => ({
  recordId,
  toStatus,
  at: new Date(at),
});

describe("firstQualifiedAt / latestWonAt", () => {
  const events = [
    ev("r1", "qualified", "2026-10-20T10:00:00Z"),
    ev("r1", "won", "2026-10-25T10:00:00Z"),
    ev("r1", "qualified", "2026-11-03T10:00:00Z"),
    ev("r1", "won", "2026-11-04T10:00:00Z"),
    ev("r2", "qualified", "2026-11-02T10:00:00Z"),
  ];

  it("takes the minimum qualified time per record", () => {
    const first = firstQualifiedAt(events);
    expect(first.get("r1")?.toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(first.get("r2")?.toISOString()).toBe("2026-11-02T10:00:00.000Z");
  });

  it("takes the maximum won time per record", () => {
    const won = latestWonAt(events);
    expect(won.get("r1")?.toISOString()).toBe("2026-11-04T10:00:00.000Z");
    expect(won.has("r2")).toBe(false);
  });
});

describe("selectConversions", () => {
  const from = new Date("2026-11-01T21:00:00Z");
  const to = new Date("2026-11-08T21:00:00Z");
  const google = (linkedRecordId: string, ids: Partial<ConversionClick> = {}): ConversionClick => ({
    linkedRecordId,
    channel: "google",
    gclid: `gclid-${linkedRecordId}`,
    gbraid: null,
    wbraid: null,
    ...ids,
  });
  const rec = (id: string, status: string, saleAmountMinor: number | null = null): ConversionRecord => ({
    id,
    status,
    saleAmountMinor,
  });

  it("keeps a first qualification inside the range with value 0", () => {
    const result = selectConversions({
      records: [rec("r1", "qualified")],
      events: [ev("r1", "qualified", "2026-11-03T10:00:00Z")],
      clicks: [google("r1")],
      from,
      to,
    });
    expect(result.rows).toEqual([
      {
        clickId: "gclid-r1",
        name: CONVERSION_QUALIFIED,
        at: new Date("2026-11-03T10:00:00Z"),
        valueMinor: 0,
        orderId: "r1:qualified",
      },
    ]);
    expect(result.skipped).toEqual({ noGoogleClick: 0, invalidClickId: 0, wbraidOnly: 0 });
  });

  it("does not export a re-qualification when the first qualification was before the range", () => {
    const result = selectConversions({
      records: [rec("r1", "qualified")],
      events: [ev("r1", "qualified", "2026-10-20T10:00:00Z"), ev("r1", "qualified", "2026-11-03T10:00:00Z")],
      clicks: [google("r1")],
      from,
      to,
    });
    expect(result.rows).toEqual([]);
  });

  it("exports a sale only for a record that is still won, at its latest won event, with the contract amount", () => {
    const result = selectConversions({
      records: [rec("r1", "won", 8_000_000), rec("r2", "proposal", null)],
      events: [
        ev("r1", "qualified", "2026-10-20T10:00:00Z"),
        ev("r1", "won", "2026-10-25T10:00:00Z"),
        ev("r1", "won", "2026-11-04T10:00:00Z"),
        ev("r2", "qualified", "2026-10-20T10:00:00Z"),
        ev("r2", "won", "2026-11-04T10:00:00Z"),
      ],
      clicks: [google("r1"), google("r2")],
      from,
      to,
    });
    expect(result.rows).toEqual([
      {
        clickId: "gclid-r1",
        name: CONVERSION_WON,
        at: new Date("2026-11-04T10:00:00Z"),
        valueMinor: 8_000_000,
        orderId: "r1:won",
      },
    ]);
  });

  it("excludes a won record whose latest won event is outside the range", () => {
    const result = selectConversions({
      records: [rec("r1", "won", 8_000_000)],
      events: [ev("r1", "won", "2026-11-04T10:00:00Z"), ev("r1", "won", "2026-11-09T10:00:00Z")],
      clicks: [google("r1")],
      from,
      to,
    });
    expect(result.rows).toEqual([]);
  });

  it("treats the range as [from, to)", () => {
    const result = selectConversions({
      records: [rec("r1", "qualified"), rec("r2", "qualified")],
      events: [ev("r1", "qualified", from.toISOString()), ev("r2", "qualified", to.toISOString())],
      clicks: [google("r1"), google("r2")],
      from,
      to,
    });
    expect(result.rows.map((r) => r.orderId)).toEqual(["r1:qualified"]);
  });

  it("skips and counts leads without a Google click, with an invalid id or with only a wbraid", () => {
    const result = selectConversions({
      records: [
        rec("none", "qualified"),
        rec("meta", "qualified"),
        rec("empty", "qualified"),
        rec("bad", "qualified"),
        rec("wb", "qualified"),
        rec("ok", "qualified"),
      ],
      events: ["none", "meta", "empty", "bad", "wb", "ok"].map((id) => ev(id, "qualified", "2026-11-03T10:00:00Z")),
      clicks: [
        { ...google("meta"), channel: "meta" },
        google("empty", { gclid: null }),
        google("bad", { gclid: "abc,def" }),
        google("wb", { gclid: null, wbraid: "W1" }),
        google("ok", { gclid: null, gbraid: "B-ok" }),
      ],
      from,
      to,
    });
    expect(result.rows.map((r) => [r.clickId, r.orderId])).toEqual([["B-ok", "ok:qualified"]]);
    expect(result.skipped).toEqual({ noGoogleClick: 3, invalidClickId: 1, wbraidOnly: 1 });
  });
});

describe("resolveExportRange", () => {
  const now = new Date("2026-11-06T10:00:00Z"); // 13:00 in Istanbul

  it("defaults to the last 7 local days ending yesterday", () => {
    const range = resolveExportRange({ from: null, to: null, timeZone: TZ, now });
    expect(range).toEqual({
      ok: true,
      fromDay: "2026-10-30",
      toDay: "2026-11-05",
      from: new Date("2026-10-29T21:00:00Z"),
      to: new Date("2026-11-05T21:00:00Z"),
    });
  });

  it("maps inclusive local days to [start of from, end of to)", () => {
    const range = resolveExportRange({ from: "2026-11-05", to: "2026-11-05", timeZone: TZ, now });
    expect(range).toMatchObject({ ok: true, from: new Date("2026-11-04T21:00:00Z"), to: new Date("2026-11-05T21:00:00Z") });
  });

  it.each([
    ["malformed", "2026-1-05", "2026-11-05"],
    ["not a real date", "2026-02-30", "2026-03-01"],
    ["reversed", "2026-11-05", "2026-11-01"],
    ["only one end", "2026-11-05", null],
    ["over 92 days", "2026-01-01", "2026-04-03"],
  ])("refuses a %s range", (_label, from, to) => {
    expect(resolveExportRange({ from, to, timeZone: TZ, now }).ok).toBe(false);
  });

  it("accepts exactly 92 days", () => {
    expect(resolveExportRange({ from: "2026-01-01", to: "2026-04-02", timeZone: TZ, now }).ok).toBe(true);
  });
});

// --- loadOfflineConversions over a fake postgres client --------------------

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const RECORD_ID = "00000000-0000-4000-8000-0000000000aa";

const h = vi.hoisted(() => ({ queries: [] as { query: string; params: unknown[] }[] }));

/** Rows in select-field order: drizzle reads them positionally through `.values()`. */
function rowsFor(query: string): Record<string, unknown>[] {
  // The first FROM is the outer table; the record-id subquery reads lead_events too.
  const table = /from "(\w+)"/.exec(query)?.[1];
  if (table === "lead_events") {
    return [
      { recordId: RECORD_ID, toStatus: "qualified", at: "2026-11-03T10:00:00.000Z" },
      { recordId: RECORD_ID, toStatus: "won", at: "2026-11-04T10:00:00.000Z" },
    ];
  }
  if (table === "company_records") {
    return [{ id: RECORD_ID, status: "won", saleAmountMinor: 8_000_000 }];
  }
  if (table === "ad_clicks") {
    return [{ linkedRecordId: RECORD_ID, channel: "google", gclid: "Cj0KCQ-test", gbraid: null, wbraid: null }];
  }
  return [];
}

function fakePostgres() {
  const run = (query: string, params: unknown[] = []) => {
    h.queries.push({ query, params });
    const bad = params.some((p) => p instanceof Date);
    const settle = <T,>(value: () => T) =>
      bad ? Promise.reject(new TypeError("Received an instance of Date")) : Promise.resolve(value());
    const rows = rowsFor(query);
    return {
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => settle(() => rows).then(ok, fail),
      values: () => settle(() => rows.map((r) => Object.values(r))),
    };
  };
  return { unsafe: run, options: { parsers: {}, serializers: {} } };
}

describe("loadOfflineConversions", () => {
  const from = new Date("2026-11-01T21:00:00Z");
  const to = new Date("2026-11-08T21:00:00Z");

  beforeEach(() => {
    h.queries = [];
  });

  it("binds the company and the range as parameters and runs only SELECTs", async () => {
    const executor = drizzle(fakePostgres() as never, { schema });
    await loadOfflineConversions(executor, { companyId: COMPANY_ID, from, to });

    expect(h.queries.length).toBeGreaterThan(0);
    for (const { query, params } of h.queries) {
      expect(query.trimStart().toLowerCase().startsWith("select")).toBe(true);
      expect(query).not.toMatch(/\b(insert|update|delete)\b/i);
      expect(query).not.toContain(COMPANY_ID);
      expect(params).toContain(COMPANY_ID);
    }
    const allParams = h.queries.flatMap((q) => q.params);
    expect(allParams).toContain(from.toISOString());
    expect(allParams).toContain(to.toISOString());
  });

  it("feeds the returned rows to selectConversions", async () => {
    const executor = drizzle(fakePostgres() as never, { schema });
    const result = await loadOfflineConversions(executor, { companyId: COMPANY_ID, from, to });

    expect(result.rows.map((r) => [r.clickId, r.name, r.valueMinor, r.orderId])).toEqual([
      ["Cj0KCQ-test", CONVERSION_QUALIFIED, 0, `${RECORD_ID}:qualified`],
      ["Cj0KCQ-test", CONVERSION_WON, 8_000_000, `${RECORD_ID}:won`],
    ]);
    expect(result.skipped).toEqual({ noGoogleClick: 0, invalidClickId: 0, wbraidOnly: 0 });
  });
});
