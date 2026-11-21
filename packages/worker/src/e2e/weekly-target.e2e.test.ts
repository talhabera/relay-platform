import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { E2E_ADMIN_URL, useE2eDatabase, type E2eDatabase } from "../test-utils/e2e-db";

// S95 backend e2e: the Lead engine's weekly target counts its target metric
// (`leads.qualified_delivered`) over `lead_events`, week to date for the ISO
// week (Monday 00:00) in company time. A lead counts once, on its first
// delivery, whoever (agent or person) delivered it.
//
// Company in Europe/Istanbul (UTC+3). "Now" is Wednesday 2026-10-07 12:00
// local; the week started Monday 2026-10-05 00:00 local = 2026-10-04T21:00Z.

const TZ = "Europe/Istanbul";
const NOW = new Date("2026-10-07T09:00:00Z");
const iso = (s: string) => new Date(s);

describe.skipIf(!E2E_ADMIN_URL)("weekly target over lead_events (e2e)", () => {
  let database: E2eDatabase;
  let dbm: typeof import("@relay/db");
  let events: typeof import("@relay/db/lead-events");
  let reports: typeof import("@relay/db/report-snapshots");
  let companyId = "";
  let otherId = "";
  let mailerId = "";

  beforeAll(async () => {
    database = await useE2eDatabase();
    dbm = await import("@relay/db");
    events = await import("@relay/db/lead-events");
    reports = await import("@relay/db/report-snapshots");
    const { db, users, companies, agents, workflows } = dbm;
    await db.insert(users).values({ id: "owner-w", name: "Owner", email: "owner-w@example.com" });
    const [company] = await db
      .insert(companies)
      .values({ name: "Acme", ownerId: "owner-w", timezone: TZ })
      .returning({ id: companies.id });
    companyId = company.id;
    const [other] = await db
      .insert(companies)
      .values({ name: "Other", ownerId: "owner-w", timezone: TZ })
      .returning({ id: companies.id });
    otherId = other.id;
    const [mailer] = await db
      .insert(agents)
      .values({ name: "Mail Marketer", companyId, kind: "operator", packageSlug: "lead-engine" })
      .returning({ id: agents.id });
    mailerId = mailer.id;
    await db.insert(workflows).values({
      companyId,
      packageSlug: "lead-engine",
      name: "Lead engine",
      flow: "sequence",
      position: 0,
      weeklyTarget: 10,
      targetMetricKey: "leads.qualified_delivered",
      intake: [],
    });
  });

  afterAll(async () => {
    if (dbm) await dbm.db.$client.end();
    if (database) await database.drop();
  });

  async function lead(cid: string, name: string) {
    const { db, companyRecords } = dbm;
    const [row] = await db
      .insert(companyRecords)
      .values({ companyId: cid, entityType: "account", name, status: "qualified" })
      .returning({ id: companyRecords.id });
    return row.id;
  }

  function move(
    cid: string,
    recordId: string,
    toStatus: "delivered" | "contacted",
    at: string,
    actor: { agentId: string } | { userId: string },
  ) {
    return events.transitionLeadStatus(dbm.db, { companyId: cid, recordId, toStatus, actor, at: iso(at) });
  }

  /** Week-to-date progress of the company's Lead engine target, as the card reads it. */
  async function weeklyProgress(cid: string, now: Date) {
    const { db, workflows, companies } = dbm;
    const { eq } = await import("drizzle-orm");
    const [company] = await db.select().from(companies).where(eq(companies.id, cid));
    const [workflow] = await db.select().from(workflows).where(eq(workflows.companyId, cid));
    const timeZone = reports.reportTimeZone(company.timezone);
    const range = reports.reportPeriodRange("weekly", now, timeZone);
    const facts = await reports.loadReportFacts(db, cid, "weekly", range, timeZone);
    const built = reports.buildReportSnapshot("weekly", range, timeZone, facts);
    const m = built.metrics.find((x) => x.metricKey === workflow.targetMetricKey);
    return { range, target: workflow.weeklyTarget, value: m?.value ?? 0, previous: m?.previous ?? 0 };
  }

  it("rejects an event with no actor or two actors", async () => {
    const id = await lead(companyId, "Actorless");
    await expect(
      events.insertLeadEvent(dbm.db, {
        companyId,
        recordId: id,
        fromStatus: null,
        toStatus: "gathered",
        actor: { agentId: mailerId, userId: "owner-w" } as unknown as { agentId: string },
      }),
    ).rejects.toThrow();
    const { sql } = await import("drizzle-orm");
    await expect(
      dbm.db.execute(
        sql`INSERT INTO lead_events (company_id, record_id, to_status) VALUES (${companyId}, ${id}, 'gathered')`,
      ),
    ).rejects.toThrow();
  });

  it("counts first deliveries in the company's ISO week, once per lead", async () => {
    const owner = { userId: "owner-w" };
    const agent = { agentId: mailerId };

    // L1: agent delivers Monday 00:10 local (Sunday 21:10Z): this week.
    await move(companyId, await lead(companyId, "L1"), "delivered", "2026-10-04T21:10:00Z", agent);
    // L2: Sunday 23:50 local (20:50Z): last week.
    await move(companyId, await lead(companyId, "L2"), "delivered", "2026-10-04T20:50:00Z", agent);
    // L3: a person delivers it this week: counts the same.
    await move(companyId, await lead(companyId, "L3"), "delivered", "2026-10-06T08:00:00Z", owner);
    // L4: delivered last week, reopened and redelivered this week: not again.
    const l4 = await lead(companyId, "L4");
    await move(companyId, l4, "delivered", "2026-09-30T10:00:00Z", agent);
    await move(companyId, l4, "contacted", "2026-10-05T10:00:00Z", agent);
    await move(companyId, l4, "delivered", "2026-10-06T10:00:00Z", agent);
    // L5: delivered twice this week: once.
    const l5 = await lead(companyId, "L5");
    await move(companyId, l5, "delivered", "2026-10-05T11:00:00Z", agent);
    await move(companyId, l5, "contacted", "2026-10-05T12:00:00Z", agent);
    await move(companyId, l5, "delivered", "2026-10-05T13:00:00Z", agent);
    // L6: a second "delivered" with no change logs nothing.
    const l6 = await lead(companyId, "L6");
    await move(companyId, l6, "delivered", "2026-10-06T09:00:00Z", agent);
    const same = await move(companyId, l6, "delivered", "2026-10-06T09:30:00Z", agent);
    expect(same).toEqual({ changed: false, reason: "same_status" });
    // Another company's delivery never counts here.
    await move(otherId, await lead(otherId, "X1"), "delivered", "2026-10-06T08:00:00Z", owner);

    const progress = await weeklyProgress(companyId, NOW);
    expect(progress.range).toEqual({
      from: iso("2026-10-04T21:00:00Z"),
      to: iso("2026-10-11T21:00:00Z"),
    });
    // L1, L3, L5, L6 this week; L2 and L4 last week.
    expect(progress).toMatchObject({ target: 10, value: 4, previous: 2 });
  });

  it("switches weeks at Monday 00:00 local, not 00:00 UTC", async () => {
    // Monday 00:05 local already reads this week.
    const early = await weeklyProgress(companyId, iso("2026-10-04T21:05:00Z"));
    expect(early.value).toBe(4);
    // Sunday 23:59 local is the previous week: L2 and L4's first delivery.
    const lastWeek = await weeklyProgress(companyId, iso("2026-10-04T20:59:00Z"));
    expect(lastWeek.range.to).toEqual(iso("2026-10-04T21:00:00Z"));
    expect(lastWeek.value).toBe(2);
  });
});
