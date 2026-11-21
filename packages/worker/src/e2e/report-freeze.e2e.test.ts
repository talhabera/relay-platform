import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { E2E_ADMIN_URL, useE2eDatabase, type E2eDatabase } from "../test-utils/e2e-db";

// S95 backend e2e: the cron freeze writes daily, weekly and monthly report
// snapshots at period close in the company's own timezone, from real
// `lead_events`, `chats` and `handoff_requests` rows.
//
// Company in Europe/Istanbul (UTC+3, no DST). The tick runs at
// 2026-10-04T21:05Z = Monday 2026-10-05 00:05 local, so the closed periods are
// Sunday 2026-10-04, ISO week 2026-W40 (Mon 09-28 .. Sun 10-04) and September.
// Every event sits a few minutes either side of a local boundary that is not
// a UTC boundary, so counting in UTC would give different numbers.

const TZ = "Europe/Istanbul";
const NOW = new Date("2026-10-04T21:05:00Z");

const WEEK_FROM = new Date("2026-09-27T21:00:00Z"); // Mon 09-28 00:00 local
const WEEK_TO = new Date("2026-10-04T21:00:00Z"); // Mon 10-05 00:00 local
const MONTH_FROM = new Date("2026-08-31T21:00:00Z"); // Sep 1 00:00 local
const MONTH_TO = new Date("2026-09-30T21:00:00Z"); // Oct 1 00:00 local
const DAY_FROM = new Date("2026-10-03T21:00:00Z"); // Sun 10-04 00:00 local

const iso = (s: string) => new Date(s);

describe.skipIf(!E2E_ADMIN_URL)("report snapshot freeze in company time (e2e)", () => {
  let database: E2eDatabase;
  let dbm: typeof import("@relay/db");
  let leadEventsMod: typeof import("@relay/db/lead-events");
  let freezeMod: typeof import("../reports/freeze");
  let companyId = "";
  let utcCompanyId = "";

  beforeAll(async () => {
    database = await useE2eDatabase();
    dbm = await import("@relay/db");
    leadEventsMod = await import("@relay/db/lead-events");
    freezeMod = await import("../reports/freeze");
    const { db, users, companies, agents, companyRecords, chats, handoffRequests } = dbm;

    await db.insert(users).values({ id: "owner-r", name: "Owner", email: "owner-r@example.com" });
    const [company] = await db
      .insert(companies)
      .values({ name: "Acme", ownerId: "owner-r", timezone: TZ, createdAt: iso("2026-06-01T00:00:00Z") })
      .returning({ id: companies.id });
    companyId = company.id;
    // Same rows in a UTC company: the week and month cut differently.
    const [utc] = await db
      .insert(companies)
      .values({ name: "Acme UTC", ownerId: "owner-r", timezone: "UTC", createdAt: iso("2026-06-01T00:00:00Z") })
      .returning({ id: companies.id });
    utcCompanyId = utc.id;

    for (const cid of [companyId, utcCompanyId]) {
      const [customer] = await db
        .insert(agents)
        .values({ name: "Widget", companyId: cid, kind: "customer" })
        .returning({ id: agents.id });
      const [gatherer] = await db
        .insert(agents)
        .values({ name: "Lead Gatherer", companyId: cid, kind: "operator" })
        .returning({ id: agents.id });

      async function lead(name: string, score: number | null) {
        const [row] = await db
          .insert(companyRecords)
          .values({ companyId: cid, entityType: "account", name, score })
          .returning({ id: companyRecords.id });
        return row.id;
      }
      const transition = (recordId: string, toStatus: "qualified" | "delivered" | "contacted", at: string) =>
        leadEventsMod.transitionLeadStatus(db, {
          companyId: cid,
          recordId,
          toStatus,
          actor: { userId: "owner-r" },
          at: iso(at),
        });

      // A: gathered, qualified and delivered Monday 00:05-00:30 local =
      // Sunday 21:05-21:30 UTC. Istanbul W40 Monday; UTC W39 Sunday.
      const a = await lead("Acme", 80);
      await leadEventsMod.insertLeadEvent(db, {
        companyId: cid, recordId: a, fromStatus: null, toStatus: "gathered",
        actor: { agentId: gatherer.id }, at: iso("2026-09-27T21:05:00Z"),
      });
      await transition(a, "qualified", "2026-09-27T21:20:00Z");
      await transition(a, "delivered", "2026-09-27T21:30:00Z");

      // B: delivered Sunday 23:30 local = 20:30 UTC: the last minutes of W40.
      const b = await lead("Beta", 90);
      await leadEventsMod.insertLeadEvent(db, {
        companyId: cid, recordId: b, fromStatus: null, toStatus: "pending",
        actor: { agentId: customer.id }, at: iso("2026-10-04T20:00:00Z"),
      });
      await transition(b, "delivered", "2026-10-04T20:30:00Z");

      // C: delivered Monday 00:01 local of the next week (W41): not this week.
      const c = await lead("Gamma", 40);
      await transition(c, "delivered", "2026-10-04T21:01:00Z");

      // D: delivered Sep 1 00:30 local (still August in UTC), so September in
      // Istanbul. Redelivered inside W40: a lead counts once, on its first
      // delivery, so W40 must not count it.
      const d = await lead("Delta", 70);
      await transition(d, "delivered", "2026-08-31T21:30:00Z");
      await transition(d, "contacted", "2026-09-29T10:00:00Z");
      await transition(d, "delivered", "2026-09-30T10:00:00Z");

      // E: delivered Aug 31 23:59 local (20:59Z): August in both zones, so
      // only September's previous-month value sees it.
      const e = await lead("Epsilon", null);
      await transition(e, "delivered", "2026-08-31T20:59:00Z");

      // A customer conversation at Monday 00:10 local (Sunday UTC) and a staff
      // answer at Sunday 23:50 local; both inside W40 and the day of 10-04 or
      // Monday 09-28 in Istanbul.
      const [chat] = await db
        .insert(chats)
        .values({
          companyId: cid,
          agentId: customer.id,
          channelType: "whatsapp",
          createdAt: iso("2026-09-27T21:10:00Z"),
        })
        .returning({ id: chats.id });
      await db.insert(handoffRequests).values({
        companyId: cid,
        chatId: chat.id,
        agentId: customer.id,
        status: "answered",
        mode: "quick_answer",
        tokenHash: `hash-${cid}`,
        reason: "out_of_scope",
        confidence: 40,
        questions: [{ text: "Price?", askedAt: "2026-10-04T20:40:00Z" }],
        expiresAt: iso("2026-10-05T20:50:00Z"),
        answeredAt: iso("2026-10-04T20:50:00Z"),
      });
    }
  });

  afterAll(async () => {
    if (dbm) await dbm.db.$client.end();
    if (database) await database.drop();
  });

  async function snapshots(cid: string) {
    const { db, reportSnapshots } = dbm;
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(reportSnapshots).where(eq(reportSnapshots.companyId, cid));
    return new Map(rows.map((r) => [r.period, r]));
  }

  const metric = (row: { metrics: { metricKey: string; value: number; previous: number | null }[] }, key: string) =>
    row.metrics.find((m) => m.metricKey === key);

  it("freezes each closed period once, on local boundaries", async () => {
    const first = await freezeMod.freezeDueReportSnapshots(NOW);
    expect(first).toEqual({ frozen: 6, failed: 0 });

    const rows = await snapshots(companyId);
    expect(rows.get("daily")).toMatchObject({ start: DAY_FROM, end: WEEK_TO });
    expect(rows.get("weekly")).toMatchObject({ start: WEEK_FROM, end: WEEK_TO });
    expect(rows.get("monthly")).toMatchObject({ start: MONTH_FROM, end: MONTH_TO });

    // A later tick in the same period, or a restart, writes nothing new.
    const again = await freezeMod.freezeDueReportSnapshots(new Date(NOW.getTime() + 60_000));
    expect(again).toEqual({ frozen: 0, failed: 0 });
  });

  it("counts the week in company time: first deliveries only", async () => {
    const weekly = (await snapshots(companyId)).get("weekly")!;
    // A (Mon 00:30 local) and B (Sun 23:30 local); not C (next week), not D
    // (first delivered in August UTC / September local, before this week).
    expect(metric(weekly, "leads.qualified_delivered")).toEqual({
      metricKey: "leads.qualified_delivered",
      value: 2,
      previous: 0,
    });
    expect(metric(weekly, "leads.quality_score")?.value).toBe(85);
    expect(metric(weekly, "leads.inbound")?.value).toBe(1);
    expect(metric(weekly, "conversations.started")?.value).toBe(1);
    expect(metric(weekly, "handoff.staff_answers")?.value).toBe(1);
    expect(weekly.series.delivered.map((b) => b.label)).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
    expect(weekly.series.delivered.map((b) => b.value)).toEqual([1, 0, 0, 0, 0, 0, 1]);
    expect(weekly.series.funnel).toEqual([
      { stage: "gathered", value: 1 },
      { stage: "qualified", value: 1 },
      { stage: "contacted", value: 1 },
      { stage: "delivered", value: 2 },
    ]);
  });

  it("counts the day and the month in company time", async () => {
    const rows = await snapshots(companyId);
    const daily = rows.get("daily")!;
    expect(metric(daily, "leads.qualified_delivered")?.value).toBe(1); // B
    expect(metric(daily, "handoff.staff_answers")?.value).toBe(1);
    expect(daily.series.delivered).toEqual([]);

    const monthly = rows.get("monthly")!;
    // September local: D (Sep 1 00:30 local) and A (Sep 28 00:30 local).
    // August local (previous): E only.
    expect(metric(monthly, "leads.qualified_delivered")).toMatchObject({ value: 2, previous: 1 });
    expect(monthly.series.delivered.map((b) => b.label)).toEqual([
      "2026-W36", "2026-W37", "2026-W38", "2026-W39", "2026-W40",
    ]);
    expect(monthly.series.delivered.map((b) => b.value)).toEqual([1, 0, 0, 0, 1]);
  });

  it("cuts a UTC company's periods differently from the same rows", async () => {
    const rows = await snapshots(utcCompanyId);
    const weekly = rows.get("weekly")!;
    // At 21:05Z Sunday the UTC week W40 is still open: the closed week is W39
    // (09-21 .. 09-28 UTC), which holds A's whole path.
    expect(weekly.start).toEqual(iso("2026-09-21T00:00:00Z"));
    expect(weekly.end).toEqual(iso("2026-09-28T00:00:00Z"));
    expect(metric(weekly, "leads.qualified_delivered")).toMatchObject({ value: 1, previous: 0 });
    expect(weekly.series.funnel.map((f) => f.value)).toEqual([1, 1, 0, 1]);
    expect(rows.get("daily")!.start).toEqual(iso("2026-10-03T00:00:00Z"));
    const monthly = rows.get("monthly")!;
    expect(monthly.start).toEqual(iso("2026-09-01T00:00:00Z"));
    // September UTC: A only; D and E are August.
    expect(metric(monthly, "leads.qualified_delivered")).toMatchObject({ value: 1, previous: 2 });
  });
});
