import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { E2E_ADMIN_URL, useE2eDatabase, type E2eDatabase } from "../test-utils/e2e-db";

// S95 backend e2e: owner installs the Lead engine (agents, workflow, stages,
// three Schedules in company time), pauses a Schedule by hand, the cron tick
// skips it, and on resume it fires on its next slot, not at once for the slot
// it missed while paused. Social media covers the other pause: created
// "Waiting for connectors" and resumed by the connector hook.
//
// Company in Europe/Istanbul (UTC+3). Lead engine Schedules run daily at
// 07:00, 07:30 and 08:00 local = 04:00Z, 04:30Z and 05:00Z.

const TZ = "Europe/Istanbul";
const iso = (s: string) => new Date(s);

describe.skipIf(!E2E_ADMIN_URL)("package install, pause and resume (e2e)", () => {
  let database: E2eDatabase;
  let dbm: typeof import("@relay/db");
  let packages: typeof import("@relay/agent-ops/operator/packages");
  let cronOps: typeof import("@relay/agent-ops/operator/cron-jobs");
  let tick: typeof import("../cron-tick");
  let orm: typeof import("drizzle-orm");
  let companyId = "";

  function at(s: string) {
    vi.setSystemTime(iso(s));
    return iso(s);
  }

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    database = await useE2eDatabase();
    dbm = await import("@relay/db");
    packages = await import("@relay/agent-ops/operator/packages");
    cronOps = await import("@relay/agent-ops/operator/cron-jobs");
    tick = await import("../cron-tick");
    orm = await import("drizzle-orm");
    const { db, users, companies } = dbm;
    await db.insert(users).values([
      { id: "owner-p", name: "Owner", email: "owner-p@example.com" },
      { id: "other-p", name: "Other", email: "other-p@example.com" },
    ]);
    const [company] = await db
      .insert(companies)
      .values({ name: "Acme", ownerId: "owner-p", timezone: TZ })
      .returning({ id: companies.id });
    companyId = company.id;
  });

  afterAll(async () => {
    vi.useRealTimers();
    if (dbm) await dbm.db.$client.end();
    if (database) await database.drop();
  });

  async function jobs(slug: string) {
    const { db, cronJobs } = dbm;
    const rows = await db
      .select()
      .from(cronJobs)
      .where(orm.and(orm.eq(cronJobs.companyId, companyId), orm.eq(cronJobs.packageSlug, slug)));
    return new Map(rows.map((r) => [r.name, r]));
  }

  async function runTick(now: Date) {
    const { db, cronRuns } = dbm;
    const result = await tick.runCronTick(now, tick.createPgTickDeps(db));
    if (result.started.length === 0) return [];
    const rows = await db
      .select({ jobId: cronRuns.jobId })
      .from(cronRuns)
      .where(orm.inArray(cronRuns.id, result.started));
    return rows.map((r) => r.jobId);
  }

  let leadJobs: Awaited<ReturnType<typeof jobs>>;

  it("installs the Lead engine running, in company time", async () => {
    const now = at("2026-10-05T03:00:00Z"); // 06:00 local
    const result = await packages.installPackage("owner-p", companyId, "lead-engine", now);
    expect(result.waitingFor).toEqual([]);
    expect(result.agentIds).toHaveLength(3);
    expect(result.cronJobIds).toHaveLength(3);

    leadJobs = await jobs("lead-engine");
    expect(
      [...leadJobs.values()].map((j) => [j.name, j.enabled, j.pausedReason, j.timezone, j.nextFireAt.toISOString()]),
    ).toEqual(
      expect.arrayContaining([
        ["Gather leads", true, null, TZ, "2026-10-05T04:00:00.000Z"],
        ["Qualify leads", true, null, TZ, "2026-10-05T04:30:00.000Z"],
        ["Outreach follow-up", true, null, TZ, "2026-10-05T05:00:00.000Z"],
      ]),
    );

    const { db, agents, agentVersions, workflows, workflowStages } = dbm;
    const agentRows = await db
      .select({ id: agents.id, kind: agents.kind, slug: agents.packageSlug })
      .from(agents)
      .where(orm.eq(agents.companyId, companyId));
    expect(agentRows.every((a) => a.kind === "operator" && a.slug === "lead-engine")).toBe(true);
    const versions = await db
      .select({ status: agentVersions.status })
      .from(agentVersions)
      .where(orm.inArray(agentVersions.agentId, result.agentIds));
    expect(versions.map((v) => v.status)).toEqual(["live", "live", "live"]);

    const [workflow] = await db.select().from(workflows).where(orm.eq(workflows.companyId, companyId));
    expect(workflow).toMatchObject({
      packageSlug: "lead-engine",
      weeklyTarget: 10,
      targetMetricKey: "leads.qualified_delivered",
    });
    const stages = await db
      .select()
      .from(workflowStages)
      .where(orm.eq(workflowStages.workflowId, workflow.id))
      .orderBy(workflowStages.order);
    expect(stages.map((s) => s.name)).toEqual(["Gather", "Qualify", "Outreach", "Delivered to client"]);
    expect(stages[3].agentId).toBeNull();
    expect(workflow.inboundStageId).toBe(stages[1].id);
  });

  it("refuses a second install and a non-owner, writing nothing", async () => {
    await expect(packages.installPackage("owner-p", companyId, "lead-engine")).rejects.toMatchObject({
      code: "already_installed",
    });
    await expect(packages.installPackage("other-p", companyId, "insights")).rejects.toThrow(/Unauthorized/);
    const { db, agents } = dbm;
    const rows = await db.select({ id: agents.id }).from(agents).where(orm.eq(agents.companyId, companyId));
    expect(rows).toHaveLength(3);
  });

  it("skips a paused Lead engine Schedule on the tick", async () => {
    const gather = leadJobs.get("Gather leads")!;
    at("2026-10-05T03:30:00Z");
    await cronOps.updateCronJob("owner-p", gather.id, { enabled: false });

    const fired = await runTick(at("2026-10-05T05:01:00Z"));
    expect(fired.sort()).toEqual(
      [leadJobs.get("Qualify leads")!.id, leadJobs.get("Outreach follow-up")!.id].sort(),
    );
    // Paused days later: still not selected.
    expect(await runTick(at("2026-10-07T04:01:00Z"))).not.toContain(gather.id);
  });

  it("resumes on the next slot, not at once for the slot missed while paused", async () => {
    const gather = leadJobs.get("Gather leads")!;
    at("2026-10-08T03:00:00Z"); // 06:00 local, before today's 07:00
    await cronOps.updateCronJob("owner-p", gather.id, { enabled: true });

    const resumed = (await jobs("lead-engine")).get("Gather leads")!;
    expect(resumed.enabled).toBe(true);
    // A pause toggle names no zone: the job keeps the company's.
    expect(resumed.timezone).toBe(TZ);
    expect(resumed.nextFireAt.toISOString()).toBe("2026-10-08T04:00:00.000Z");

    expect(await runTick(at("2026-10-08T03:01:00Z"))).not.toContain(gather.id);
    expect(await runTick(at("2026-10-08T04:01:00Z"))).toContain(gather.id);
  });

  it("creates Social media Schedules waiting for connectors and resumes them on connect", async () => {
    const now = at("2026-10-08T05:00:00Z");
    const result = await packages.installPackage("owner-p", companyId, "social-media", now);
    expect(result.waitingFor).toEqual(["meta", "google_business_profile"]);
    let social = await jobs("social-media");
    expect([...social.values()].every((j) => !j.enabled && j.pausedReason === "waiting_for_connectors")).toBe(true);

    // Waiting Schedules resume only through the connector hook.
    const first = [...social.values()][0];
    await expect(cronOps.updateCronJob("owner-p", first.id, { enabled: true })).rejects.toThrow(
      /Waiting for connectors/,
    );

    // Lead engine's hand pause is not a connector wait: the hook leaves it.
    const gather = leadJobs.get("Gather leads")!;
    await cronOps.updateCronJob("owner-p", gather.id, { enabled: false });

    const { db, integrations } = dbm;
    await db.insert(integrations).values({ name: "Meta", type: "meta", companyId, status: "connected" });
    expect(await packages.resumeWaitingPackageSchedules(companyId, at("2026-10-09T05:00:00Z"))).toEqual([]);

    await db
      .insert(integrations)
      .values({ name: "GBP", type: "google_business_profile", companyId, status: "connected" });
    const resumedIds = await packages.resumeWaitingPackageSchedules(companyId, at("2026-10-09T05:00:00Z"));
    expect(resumedIds.sort()).toEqual([...social.values()].map((j) => j.id).sort());

    social = await jobs("social-media");
    const review = social.get("Review check")!;
    expect(review).toMatchObject({ enabled: true, pausedReason: null });
    // Daily 10:00 local = 07:00Z, the next slot after the connect.
    expect(review.nextFireAt.toISOString()).toBe("2026-10-09T07:00:00.000Z");
    expect((await jobs("lead-engine")).get("Gather leads")!.enabled).toBe(false);

    expect(await runTick(at("2026-10-09T07:01:00Z"))).toContain(review.id);
  });
});
