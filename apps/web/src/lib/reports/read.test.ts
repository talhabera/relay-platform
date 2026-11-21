import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { getReportSnapshot, toReportSnapshot } from "./read";

const row = {
  id: "8b0f3c1e-2a4d-4c5b-9e6f-7a8b9c0d1e2f",
  companyId: "c-acme",
  period: "weekly" as const,
  start: new Date("2026-09-13T22:00:00Z"),
  end: new Date("2026-09-20T22:00:00Z"),
  metrics: [{ metricKey: "leads.qualified_delivered", value: 8, previous: 6 }],
  series: { delivered: [{ label: "2026-09-14", value: 1 }], funnel: [{ stage: "gathered" as const, value: 131 }] },
  narrative: null,
  frozenAt: new Date("2026-09-21T06:00:00Z"),
};

describe("toReportSnapshot", () => {
  it("maps a report_snapshots row to the ReportSnapshot interface", () => {
    expect(toReportSnapshot(row)).toEqual({
      id: row.id,
      companyId: "c-acme",
      period: "weekly",
      start: row.start,
      end: row.end,
      metrics: [{ metricKey: "leads.qualified_delivered", value: 8, previous: 6 }],
      series: row.series,
      narrative: null,
      frozenAt: row.frozenAt,
    });
  });
});

describe("getReportSnapshot", () => {
  it("returns null for a malformed id without querying", async () => {
    expect(await getReportSnapshot("c-acme", "not-a-uuid")).toBeNull();
  });
});
