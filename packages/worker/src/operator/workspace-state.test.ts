import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@relay/db/schema";
import { getPackageDefinition, missingRequiredConnectors, PACKAGE_SLUGS } from "@relay/db";
import { createE2eDatabase, E2E_ADMIN_URL, type E2eDatabase } from "../test-utils/e2e-db";
import {
  loadWorkspaceState,
  scheduleHref,
  taskHref,
  WORKSPACE_STATE_SECTION_LIMIT,
} from "./workspace-state";

describe("taskHref", () => {
  it("links to the task in the operator Tasks tab", () => {
    expect(taskHref("abc")).toBe("/operator?tab=tasks&task=abc");
  });
});

// Real Postgres (RELAY_E2E_DB_URL, see test-utils/e2e-db.ts): the snapshot's
// company scoping is a property of its SQL, so it is checked against SQL.

const NOW = new Date("2026-10-22T05:30:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const SECRET = "sk-live-do-not-leak";

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
  else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      into.add(key);
      keysOf(v, into);
    }
  }
  return into;
}

describe.skipIf(!E2E_ADMIN_URL)("loadWorkspaceState (e2e)", () => {
  let database: E2eDatabase;
  let client: postgres.Sql;
  let edb: ReturnType<typeof drizzle<typeof schema>>;
  let companyId = "";
  let otherId = "";
  let emptyId = "";
  let otherJobId = "";

  async function seedCompany(name: string, timezone: string) {
    const [company] = await edb
      .insert(schema.companies)
      .values({ name, ownerId: "owner-ws", timezone })
      .returning({ id: schema.companies.id });
    const [agent] = await edb
      .insert(schema.agents)
      .values({ name: `${name} Manager`, companyId: company.id, kind: "operator" })
      .returning({ id: schema.agents.id });
    const [version] = await edb
      .insert(schema.agentVersions)
      .values({ agentId: agent.id, name: "v1" })
      .returning({ id: schema.agentVersions.id });
    return { companyId: company.id, agentId: agent.id, versionId: version.id };
  }

  function job(
    seed: { companyId: string; agentId: string; versionId: string },
    values: Partial<typeof schema.cronJobs.$inferInsert> & { name: string },
  ) {
    return {
      companyId: seed.companyId,
      agentId: seed.agentId,
      versionId: seed.versionId,
      prompt: "Do the thing.",
      scheduleKind: "daily" as const,
      timeOfDay: 510,
      nextFireAt: NOW,
      ...values,
    };
  }

  // Creating and migrating a fresh database takes longer than the default hook timeout.
  beforeAll(async () => {
    database = await createE2eDatabase();
    client = postgres(database.url, { max: 2, onnotice: () => undefined });
    edb = drizzle(client, { schema });
    await edb
      .insert(schema.users)
      .values({ id: "owner-ws", name: "Owner", email: "owner-ws@example.com" });

    const a = await seedCompany("Koleva", "Europe/Istanbul");
    const b = await seedCompany("Other", "UTC");
    const empty = await seedCompany("Empty", "Europe/Istanbul");
    companyId = a.companyId;
    otherId = b.companyId;
    emptyId = empty.companyId;

    // Schedules: 12 turned off + 1 waiting for connectors, 1 running.
    await edb.insert(schema.cronJobs).values([
      ...Array.from({ length: 12 }, (_, i) =>
        job(a, { name: `Off ${String(i).padStart(2, "0")}`, enabled: false }),
      ),
      job(a, {
        name: "Social posts",
        enabled: false,
        pausedReason: "waiting_for_connectors",
        packageSlug: "social-media",
      }),
    ]);
    const [running] = await edb
      .insert(schema.cronJobs)
      .values(job(a, { name: "Running" }))
      .returning({ id: schema.cronJobs.id });
    const [otherJob] = await edb
      .insert(schema.cronJobs)
      .values(job(b, { name: "Other company job", enabled: false }))
      .returning({ id: schema.cronJobs.id });
    otherJobId = otherJob.id;

    await edb.insert(schema.cronRuns).values([
      { jobId: running.id, status: "failed", fireAt: hoursAgo(3), error: "x".repeat(300) },
      { jobId: running.id, status: "failed", fireAt: hoursAgo(30), error: "too old" },
      { jobId: running.id, status: "succeeded", fireAt: hoursAgo(2) },
      { jobId: otherJob.id, status: "failed", fireAt: hoursAgo(1), error: "other" },
    ]);
    // Questions and checkpoints need a parent session or run.
    const [parentA, parentB] = await edb
      .insert(schema.cronRuns)
      .values([
        { jobId: running.id, status: "awaiting_input", fireAt: hoursAgo(1) },
        { jobId: otherJob.id, status: "awaiting_input", fireAt: hoursAgo(1) },
      ])
      .returning({ id: schema.cronRuns.id });
    const pa = { companyId: a.companyId, agentId: a.agentId, cronRunId: parentA.id };
    const pb = { companyId: b.companyId, agentId: b.agentId, cronRunId: parentB.id };

    await edb.insert(schema.agentQuestions).values([
      { ...pa, question: "Q1?" },
      { ...pa, question: "Q2?" },
      { ...pa, question: "Q3?", status: "answered", answer: "Yes", answeredAt: hoursAgo(1) },
      { ...pb, question: "Other?" },
    ]);

    const payload = { kind: "post" } as unknown as typeof schema.checkpoints.$inferInsert.payload;
    await edb.insert(schema.checkpoints).values([
      { ...pa, kind: "outreach", payload, status: "pending" },
      { ...pa, kind: "outreach", payload, status: "failed" },
      { ...pa, kind: "post", payload, status: "stale" },
      { ...pa, kind: "post", payload, status: "approved" },
      { ...pb, kind: "post", payload, status: "pending" },
    ]);

    await edb.insert(schema.integrations).values([
      {
        name: "Hunter",
        type: "hunter",
        companyId: a.companyId,
        status: "connected",
        config: { apiKey: SECRET } as typeof schema.integrations.$inferInsert.config,
      },
      { name: "Snov", type: "snov", companyId: b.companyId, status: "connected" },
    ]);

    await edb.insert(schema.packageInstalls).values([
      { companyId: a.companyId, packageSlug: "lead-engine", catalogVersion: 1 },
      { companyId: b.companyId, packageSlug: "insights", catalogVersion: 1 },
    ]);

    await edb.insert(schema.workflows).values([
      {
        companyId: a.companyId,
        packageSlug: "lead-engine",
        name: "Lead engine",
        flow: "sequence",
        position: 0,
        weeklyTarget: 10,
        targetMetricKey: "leads.qualified_delivered",
        intake: [],
      },
      { companyId: a.companyId, packageSlug: "social-media", name: "Untargeted", flow: "sequence", position: 1, intake: [] },
    ]);

    // Inbox: expired + no reply (waiting), answered (escalated only),
    // expired then a person replied (escalated only), other company expired.
    const chatIds = await edb
      .insert(schema.chats)
      .values([
        { companyId: a.companyId, channelType: "whatsapp" },
        { companyId: a.companyId, channelType: "whatsapp" },
        { companyId: a.companyId, channelType: "instagram" },
        { companyId: b.companyId, channelType: "whatsapp" },
      ])
      .returning({ id: schema.chats.id });
    const request = (cid: string, chatId: string, status: "expired" | "answered") => ({
      companyId: cid,
      chatId,
      status,
      mode: "quick_answer" as const,
      tokenHash: `hash-${chatId}`,
      reason: "Asks for a person",
      questions: [],
      expiresAt: hoursAgo(5),
      expiredAt: status === "expired" ? hoursAgo(5) : null,
      createdAt: hoursAgo(6),
    });
    await edb.insert(schema.handoffRequests).values([
      request(a.companyId, chatIds[0].id, "expired"),
      request(a.companyId, chatIds[1].id, "answered"),
      request(a.companyId, chatIds[2].id, "expired"),
      request(b.companyId, chatIds[3].id, "expired"),
    ]);
    await edb.insert(schema.messages).values([
      { chatId: chatIds[0].id, role: "user", content: "Hello?", createdAt: hoursAgo(4) },
      { chatId: chatIds[2].id, role: "assistant", content: "Here.", author: "human", authorDisplayName: "Ayşe", createdAt: hoursAgo(4) },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (client) await client.end();
    if (database) await database.drop();
  });

  it("returns only the run's company rows", async () => {
    const state = await loadWorkspaceState(companyId, NOW, edb);
    const text = JSON.stringify(state);
    expect(text).not.toContain(otherId);
    expect(text).not.toContain(otherJobId);
    expect(text).not.toContain("Other company job");
    expect(state.needsYou.openQuestions).toBe(2);
    expect(state.needsYou.openCheckpointsByKind).toMatchObject({ outreach: 2, post: 1 });
    expect(state.inbox).toEqual({ waiting: 1, escalated: 3 });
    expect(state.connectors).toEqual([{ type: "hunter", status: "connected" }]);
    expect(state.packages).toEqual({
      installed: ["lead-engine"],
      notInstalled: PACKAGE_SLUGS.filter((slug) => slug !== "lead-engine"),
    });
    expect(state.timezone).toBe("Europe/Istanbul");
  });

  it("carries no config, credential or payload keys", async () => {
    const state = await loadWorkspaceState(companyId, NOW, edb);
    const keys = keysOf(state);
    for (const key of ["config", "apiKey", "token", "password", "payload", "content", "notes"]) {
      expect(keys.has(key)).toBe(false);
    }
    expect(JSON.stringify(state)).not.toContain(SECRET);
  });

  it("caps each list at the section limit and keeps counts exact", async () => {
    const { schedules } = await loadWorkspaceState(companyId, NOW, edb);
    expect(schedules.paused).toHaveLength(WORKSPACE_STATE_SECTION_LIMIT);
    expect(schedules.pausedTotal).toBe(13);
    expect(schedules.failedLast24h).toHaveLength(1);
    expect(schedules.failedLast24hTotal).toBe(1);
    const [failed] = schedules.failedLast24h;
    expect(failed.error!.length).toBeLessThanOrEqual(120);
    expect(failed.href).toBe(scheduleHref(failed.jobId));
  });

  it("names the connectors a waiting package Schedule needs", async () => {
    const { schedules } = await loadWorkspaceState(companyId, NOW, edb);
    const social = schedules.paused.find((job) => job.name === "Social posts");
    const expected = missingRequiredConnectors(getPackageDefinition("social-media")!, ["hunter"]);
    expect(expected.length).toBeGreaterThan(0);
    expect(social).toMatchObject({
      pausedReason: "waiting_for_connectors",
      agentName: "Koleva Manager",
      missingConnectors: expected,
    });
  });

  it("reports week-to-date progress for targeted workflows only", async () => {
    const { pipeline } = await loadWorkspaceState(companyId, NOW, edb);
    expect(pipeline).toEqual([{ workflow: "Lead engine", weeklyTarget: 10, thisWeek: 0 }]);
  });

  it("returns empty sections for a company with nothing yet", async () => {
    const state = await loadWorkspaceState(emptyId, NOW, edb);
    expect(state.schedules).toEqual({
      paused: [],
      pausedTotal: 0,
      failedLast24h: [],
      failedLast24hTotal: 0,
    });
    expect(state.needsYou.openQuestions).toBe(0);
    expect(Object.values(state.needsYou.openCheckpointsByKind).every((n) => n === 0)).toBe(true);
    expect(state.inbox).toEqual({ waiting: 0, escalated: 0 });
    expect(state.pipeline).toEqual([]);
    expect(state.packages.installed).toEqual([]);
    expect(state.connectors).toEqual([]);
    expect(state.tasks).toEqual({
      overdue: [],
      dueToday: [],
      doing: [],
      blocked: [],
      counts: { open: 0, unassigned: 0, doneYesterday: 0 },
      projects: [],
    });
    expect(state.lastBrief).toBeNull();
  });
});
