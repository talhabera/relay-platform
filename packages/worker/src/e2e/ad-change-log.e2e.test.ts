import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { E2E_ADMIN_URL, useE2eDatabase, type E2eDatabase } from "../test-utils/e2e-db";
import type { createFakeAdAdapter as CreateFake } from "../integrations/ads/fake-adapter";
import type { AdChangeCommand } from "@relay/db";

// RL8a backend e2e: ad_change_log is append-only at the database level, the
// reason CHECK holds for agent rows, and applyAdChange's advisory cap lock
// lets exactly one of two simultaneous increases through. Money in minor
// units: 1 TL = 100.

const TL = 100;

describe.skipIf(!E2E_ADMIN_URL)("ad change log and cap lock (e2e)", () => {
  let database: E2eDatabase;
  let dbm: typeof import("@relay/db");
  let mod: typeof import("../ads/apply-ad-change");
  // Loaded after useE2eDatabase: it imports @relay/db, which connects at import.
  let createFakeAdAdapter: typeof CreateFake;
  let agentId = "";
  let n = 0;

  const newCompany = async (capTl: number | null) => {
    const { db, companies } = dbm;
    const [c] = await db
      .insert(companies)
      .values({ name: `Ads ${++n}`, ownerId: "owner-ads", adDailyCapMinor: capTl === null ? null : capTl * TL })
      .returning({ id: companies.id });
    return c.id;
  };

  const raise = (campaignId: string, afterTl: number): AdChangeCommand => ({
    platform: "google",
    accountId: "acc-1",
    campaignId,
    action: "set_daily_budget",
    afterMinor: afterTl * TL,
  });

  const reason = { text: "CPL eşiğin altında", metric: "cpl_minor", value: 18_000, threshold: 30_000 };

  const logOf = (companyId: string) =>
    dbm.db
      .select()
      .from(dbm.adChangeLog)
      .where(eq(dbm.adChangeLog.companyId, companyId))
      .orderBy(asc(dbm.adChangeLog.seq));

  beforeAll(async () => {
    database = await useE2eDatabase();
    dbm = await import("@relay/db");
    mod = await import("../ads/apply-ad-change");
    ({ createFakeAdAdapter } = await import("../integrations/ads/fake-adapter"));
    const { db, users, agents } = dbm;
    await db.insert(users).values({ id: "owner-ads", name: "Owner", email: "owner-ads@example.com" });
    const companyId = await newCompany(1000);
    const [agent] = await db
      .insert(agents)
      .values({ name: "Reklam Yöneticisi", companyId, kind: "operator" })
      .returning({ id: agents.id });
    agentId = agent.id;
  }, 120_000);

  afterAll(async () => {
    await database?.drop();
  });

  // Drizzle wraps the PostgresError; its message is on `cause`.
  const pgError = async (query: Promise<unknown>) => {
    try {
      await query;
    } catch (err) {
      const e = err as Error & { cause?: Error };
      return `${e.message} ${e.cause?.message ?? ""}`;
    }
    return "no error";
  };

  const deps = (fake: ReturnType<typeof CreateFake>) => ({
    store: mod.pgAdChangeStore,
    adapterFor: () => fake,
    now: () => new Date(),
  });

  it("rejects UPDATE, DELETE and TRUNCATE, and deleting the owning company", async () => {
    const companyId = await newCompany(1000);
    const fake = createFakeAdAdapter({
      campaigns: { "acc-1": [{ campaignId: "c-1", name: "Arama", status: "enabled", dailyBudgetMinor: 100 * TL }] },
    });
    const out = await mod.applyAdChange(
      { companyId, command: raise("c-1", 150), reason, actor: { type: "agent", agentId }, autonomous: false, mode: "apply" },
      deps(fake),
    );
    expect(out.outcome).toBe("applied");
    const { db } = dbm;
    expect(
      await pgError(db.execute(sql`update ad_change_log set reason_text = 'x' where company_id = ${companyId}`)),
    ).toMatch(/ad_change_log is append-only/);
    expect(await pgError(db.execute(sql`delete from ad_change_log where company_id = ${companyId}`))).toMatch(
      /ad_change_log is append-only/,
    );
    expect(await pgError(db.execute(sql`truncate ad_change_log`))).toMatch(/ad_change_log is append-only/);
    expect(await pgError(db.execute(sql`delete from companies where id = ${companyId}`))).toMatch(
      /append-only|foreign key/,
    );
    expect(await logOf(companyId)).toHaveLength(2);
  });

  it("refuses an agent row without reason_metric", async () => {
    const companyId = await newCompany(1000);
    const err = await pgError(
      dbm.db.insert(dbm.adChangeLog).values({
        companyId,
        changeId: crypto.randomUUID(),
        phase: "intent",
        platform: "google",
        accountId: "acc-1",
        campaignId: "c-1",
        action: "pause",
        actorType: "agent",
        actorAgentId: agentId,
        reasonText: "durdur",
        reasonMetric: null,
        reasonValue: 1,
        reasonThreshold: 2,
      }),
    );
    expect(err).toMatch(/ad_change_log_reason_chk/);
    expect(await logOf(companyId)).toHaveLength(0);
  });

  it("lets exactly one of two simultaneous +600 TL increases through a 1.000 TL cap", async () => {
    // Live total 400 TL: 400 + 600 = 1.000 passes, a second +600 cannot.
    // (500 TL in the dispatch cannot let even one +600 through.)
    for (let round = 0; round < 5; round++) {
      const companyId = await newCompany(1000);
      const fake = createFakeAdAdapter({
        campaigns: {
          "acc-1": [
            { campaignId: "c-1", name: "A", status: "enabled", dailyBudgetMinor: 0 },
            { campaignId: "c-2", name: "B", status: "enabled", dailyBudgetMinor: 0 },
            { campaignId: "c-3", name: "Live", status: "enabled", dailyBudgetMinor: 400 * TL },
          ],
        },
      });
      const run = (campaignId: string) =>
        mod.applyAdChange(
          {
            companyId,
            command: raise(campaignId, 600),
            reason,
            actor: { type: "agent", agentId },
            autonomous: false,
            mode: "apply",
          },
          deps(fake),
        );
      const outcomes = (await Promise.all([run("c-1"), run("c-2")])).map((o) => o.outcome).sort();
      expect(outcomes).toEqual(["applied", "rejected"]);
      expect(fake.writeCount()).toBe(1);
      const rows = await logOf(companyId);
      expect(rows.filter((r) => r.phase === "intent")).toHaveLength(2);
      expect(rows.filter((r) => r.outcome === "rejected")[0]).toMatchObject({ outcomeCode: "cap_exceeded" });
    }
  });

  it("rejects and logs the 1.001 TL request", async () => {
    const companyId = await newCompany(1000);
    const fake = createFakeAdAdapter({
      campaigns: {
        "acc-1": [
          { campaignId: "c-1", name: "Arama", status: "enabled", dailyBudgetMinor: 490 * TL },
          { campaignId: "c-2", name: "Marka", status: "enabled", dailyBudgetMinor: 500 * TL },
        ],
      },
    });
    const out = await mod.applyAdChange(
      { companyId, command: raise("c-1", 501), reason, actor: { type: "agent", agentId }, autonomous: false, mode: "apply" },
      deps(fake),
    );
    expect(out).toMatchObject({ outcome: "rejected", code: "cap_exceeded", totalAfterMinor: 100_100 });
    expect(fake.writeCount()).toBe(0);
    const [intent, result] = await logOf(companyId);
    expect(intent).toMatchObject({
      phase: "intent",
      outcome: null,
      deltaMinor: 11 * TL,
      dailyTotalAfterMinor: 100_100,
      reasonMetric: "cpl_minor",
      actorAgentId: agentId,
    });
    expect(result).toMatchObject({
      phase: "result",
      changeId: intent.changeId,
      outcome: "rejected",
      outcomeCode: "cap_exceeded",
      dailyTotalAfterMinor: 100_100,
    });
  });

  it("counts approved ad_change cards, except the one being applied", async () => {
    const companyId = await newCompany(1000);
    const fake = createFakeAdAdapter({
      campaigns: {
        "acc-1": [
          { campaignId: "c-1", name: "A", status: "enabled", dailyBudgetMinor: 0 },
          { campaignId: "c-3", name: "Live", status: "enabled", dailyBudgetMinor: 400 * TL },
        ],
      },
    });
    const [chat] = await dbm.db
      .insert(dbm.chats)
      .values({ companyId, agentId, channelType: "operator" })
      .returning({ id: dbm.chats.id });
    const card = async () => {
      const rows = await dbm.db.execute<{ id: string }>(sql`
        insert into checkpoints (company_id, agent_id, chat_id, kind, payload, status)
        values (${companyId}, ${agentId}, ${chat.id}, 'ad_change',
                ${JSON.stringify({ kind: "ad_change", deltaMinor: 600 * TL })}::jsonb, 'approved')
        returning id`);
      return rows[0].id;
    };
    const cpA = await card();
    const cpB = await card();
    const apply = (checkpointId: string) =>
      mod.applyAdChange(
        {
          companyId,
          command: raise("c-1", 600),
          reason: { text: "Uygulandı" },
          actor: { type: "human", userId: "owner-ads" },
          autonomous: false,
          checkpointId,
          attempt: 1,
          mode: "apply",
        },
        deps(fake),
      );
    // B is approved and unapplied, so A sees 400 + 600 (B) + 600 > 1.000.
    expect(await apply(cpA)).toMatchObject({ outcome: "rejected", totalAfterMinor: 1_600 * TL });
    // A is now logged, so it no longer reserves; B alone fits exactly.
    expect(await apply(cpB)).toMatchObject({ outcome: "applied", totalAfterMinor: 1_000 * TL });
    expect(fake.writeCount()).toBe(1);
  });
});
