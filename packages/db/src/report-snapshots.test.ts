import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  buildReportSnapshot,
  normalizeReportNarrative,
  ReportNarrativeError,
  reportPeriodRange,
  writeReportNarrative,
  type ReportExecutor,
  type ReportFacts,
  type ReportLeadEventFact,
} from "./report-snapshots";
import { reportSnapshots } from "./schema/report-snapshots";

const TZ = "Europe/Berlin";
// Week Mon 14 - Sun 20 Sep 2026 (Berlin), previous week 7-13 Sep.
const week = reportPeriodRange("weekly", new Date("2026-09-16T12:00:00Z"), TZ);
const CUSTOMER = "agent-customer";
const GATHERER = "agent-gatherer";

const ev = (
  recordId: string,
  fromStatus: string | null,
  toStatus: string,
  at: string,
  agentId: string | null = GATHERER,
): ReportLeadEventFact => ({ recordId, fromStatus, toStatus, agentId, at: new Date(at) });

function facts(over: Partial<ReportFacts> = {}): ReportFacts {
  return {
    leadEvents: [],
    customerAgentIds: new Set([CUSTOMER]),
    scores: new Map(),
    conversationsAt: [],
    staffAnswersAt: [],
    ...over,
  };
}

const metric = (built: ReturnType<typeof buildReportSnapshot>, key: string) =>
  built.metrics.find((m) => m.metricKey === key);

describe("buildReportSnapshot", () => {
  const leadEvents = [
    // Previous week: one delivered lead.
    ev("old", "qualified", "delivered", "2026-09-08T10:00:00Z"),
    // This week: inbound lead from a customer agent, later delivered.
    ev("in1", null, "pending", "2026-09-14T08:00:00Z", CUSTOMER),
    ev("in1", "pending", "qualified", "2026-09-14T09:00:00Z"),
    ev("in1", "qualified", "delivered", "2026-09-15T09:00:00Z"),
    // Gathered by an operator agent, qualified, contacted, delivered Sunday.
    ev("g1", null, "gathered", "2026-09-16T08:00:00Z"),
    ev("g1", "gathered", "qualified", "2026-09-16T09:00:00Z"),
    ev("g1", "qualified", "contacted", "2026-09-17T09:00:00Z"),
    ev("g1", "contacted", "delivered", "2026-09-20T20:00:00Z"),
    // Re-delivered this week: first delivery was last week, so not counted.
    ev("old", "delivered", "delivered", "2026-09-15T12:00:00Z"),
    // After the week closed (Mon 21 Sep 00:30 Berlin): not in this period.
    ev("late", null, "gathered", "2026-09-20T22:30:00Z"),
  ];

  const built = buildReportSnapshot(
    "weekly",
    week,
    TZ,
    facts({
      leadEvents,
      scores: new Map([
        ["in1", 80],
        ["g1", 70],
        ["old", 90],
      ]),
      conversationsAt: [
        new Date("2026-09-14T10:00:00Z"),
        new Date("2026-09-19T10:00:00Z"),
        new Date("2026-09-10T10:00:00Z"),
      ],
      staffAnswersAt: [new Date("2026-09-18T10:00:00Z")],
    }),
  );

  it("counts each lead once and a delivery only on the first one", () => {
    expect(metric(built, "leads.qualified_delivered")).toEqual({
      metricKey: "leads.qualified_delivered",
      value: 2,
      previous: 1,
    });
    expect(metric(built, "leads.inbound")?.value).toBe(1);
    expect(metric(built, "records.gathered")?.value).toBe(1);
    expect(metric(built, "records.qualified")?.value).toBe(2);
    expect(metric(built, "records.contacted_replied")?.value).toBe(1);
  });

  it("stores previous for every metric", () => {
    expect(metric(built, "conversations.started")).toEqual({
      metricKey: "conversations.started",
      value: 2,
      previous: 1,
    });
    expect(metric(built, "handoff.staff_answers")).toEqual({
      metricKey: "handoff.staff_answers",
      value: 1,
      previous: 0,
    });
    expect(metric(built, "leads.quality_score")).toEqual({
      metricKey: "leads.quality_score",
      value: 75,
      previous: 90,
    });
  });

  it("writes the funnel and delivered per local day", () => {
    expect(built.series.funnel).toEqual([
      { stage: "gathered", value: 1 },
      { stage: "qualified", value: 2 },
      { stage: "contacted", value: 1 },
      { stage: "delivered", value: 2 },
    ]);
    expect(built.series.delivered.map((p) => p.value)).toEqual([0, 1, 0, 0, 0, 0, 1]);
    expect(built.series.delivered[1].label).toBe("2026-09-15");
  });

  it("hides cards without a source: no posts, reviews, site visits or cost", () => {
    const keys = built.metrics.map((m) => m.metricKey);
    for (const k of ["posts.scheduled_review", "reviews.new_negative", "report.next_run"]) {
      expect(keys).not.toContain(k);
    }
  });

  it("leaves quality out when nothing scored was delivered", () => {
    const empty = buildReportSnapshot("weekly", week, TZ, facts());
    expect(metric(empty, "leads.quality_score")).toBeUndefined();
    expect(metric(empty, "leads.qualified_delivered")).toEqual({
      metricKey: "leads.qualified_delivered",
      value: 0,
      previous: 0,
    });
  });

  it("a daily snapshot has no delivered series", () => {
    const day = reportPeriodRange("daily", new Date("2026-09-15T12:00:00Z"), TZ);
    const daily = buildReportSnapshot("daily", day, TZ, facts({ leadEvents }));
    expect(daily.series.delivered).toEqual([]);
    expect(metric(daily, "leads.qualified_delivered")).toEqual({
      metricKey: "leads.qualified_delivered",
      value: 1,
      previous: 0,
    });
  });
});

describe("narrative", () => {
  it("trims and bounds the narrative", () => {
    expect(
      normalizeReportNarrative({ summary: "  Good week. ", highlights: [" a ", "", "b"] }),
    ).toEqual({ summary: "Good week.", highlights: ["a", "b"] });
    expect(() => normalizeReportNarrative({ summary: "  ", highlights: [] })).toThrow(
      ReportNarrativeError,
    );
  });

  function fakeDb(latest: { id: string } | null) {
    const sets: unknown[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => (latest ? [latest] : []) }),
          }),
        }),
      }),
      update: () => ({
        set: (values: unknown) => {
          sets.push(values);
          return {
            where: () => ({
              returning: async () => [
                { id: latest!.id, start: new Date(0), end: new Date(1) },
              ],
            }),
          };
        },
      }),
    };
    return { db: db as unknown as ReportExecutor, sets };
  }

  it("writes only the narrative onto the latest snapshot", async () => {
    const { db, sets } = fakeDb({ id: "snap-1" });
    const row = await writeReportNarrative(db, {
      companyId: "c1",
      period: "weekly",
      narrative: { summary: "Eight leads.", highlights: ["Up from six"] },
    });
    expect(row?.id).toBe("snap-1");
    expect(sets).toEqual([
      { narrative: { summary: "Eight leads.", highlights: ["Up from six"] } },
    ]);
  });

  it("returns null when no snapshot exists and refuses daily", async () => {
    const { db } = fakeDb(null);
    await expect(
      writeReportNarrative(db, {
        companyId: "c1",
        period: "monthly",
        narrative: { summary: "x", highlights: [] },
      }),
    ).resolves.toBeNull();
    await expect(
      writeReportNarrative(db, {
        companyId: "c1",
        period: "daily" as "weekly",
        narrative: { summary: "x", highlights: [] },
      }),
    ).rejects.toThrow(ReportNarrativeError);
  });
});

describe("0039_report_snapshots migration", () => {
  const dir = path.join(__dirname, "../drizzle");
  const up = readFileSync(path.join(dir, "0039_report_snapshots.sql"), "utf8");
  const down = readFileSync(path.join(dir, "down/0039_report_snapshots.sql"), "utf8");

  it("creates every column the schema declares", () => {
    for (const column of Object.values(getTableColumns(reportSnapshots))) {
      expect(up).toContain(`"${column.name}"`);
    }
  });

  it("keeps one snapshot per company, period and start and freezes the numbers", () => {
    expect(up).toContain(`"report_snapshots_company_period_start_uidx"`);
    expect(up).toMatch(/BEFORE UPDATE ON "report_snapshots"/);
    expect(up).not.toMatch(/NEW\.narrative IS DISTINCT/);
  });

  it("separates every statement with a breakpoint", () => {
    const chunks = up.split("--> statement-breakpoint");
    expect(chunks.length).toBe(6);
  });

  it("is journaled and reversible", () => {
    const journal = JSON.parse(readFileSync(path.join(dir, "meta/_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    expect(journal.entries.filter((e) => e.tag === "0039_report_snapshots")).toHaveLength(1);
    expect(down).toContain(`DROP TABLE IF EXISTS "report_snapshots"`);
    expect(down).toContain(`DROP FUNCTION IF EXISTS "report_snapshots_frozen"()`);
  });
});
