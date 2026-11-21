import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@relay/db/schema";
import { DAILY_BRIEF_MAX_ITEMS, DEFAULT_TOOL_TOGGLES, type DailyBriefItem } from "@relay/db";
import type { ReportExecutor } from "@relay/db/report-snapshots";
import { createE2eDatabase, E2E_ADMIN_URL, type E2eDatabase } from "../test-utils/e2e-db";
import { AD_MONITOR_PACKAGE, DAILY_MANAGER_PACKAGE, selectCronOperatorTools } from "./cron-tools";
import { READ_AD_STATE_TOOL } from "./ad-state";
import { POST_AD_BRIEF_TOOL } from "./ad-brief-tool";
import {
  executePostDailyBrief,
  POST_DAILY_BRIEF_TOOL,
  READ_WORKSPACE_STATE_TOOL,
} from "./daily-brief-tool";
import { taskHref } from "./workspace-state";

const run = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  agentId: "660e8400-e29b-41d4-a716-446655440001",
  cronRunId: "770e8400-e29b-41d4-a716-446655440002",
};

const item = (rank: number, overrides: Record<string, unknown> = {}) => ({
  rank,
  kind: "do",
  title: `Item ${rank}`,
  why: "Because it is waiting.",
  href: "/needs-you",
  ...overrides,
});

describe("Daily Manager tool gating", () => {
  const args = {
    companyId: run.companyId,
    agentId: run.agentId,
    cronRunId: run.cronRunId,
    version: { toolToggles: DEFAULT_TOOL_TOGGLES },
  };

  it("offers both tools to a manager package Schedule", () => {
    const tools = selectCronOperatorTools({ ...args, packageSlug: DAILY_MANAGER_PACKAGE });
    expect(tools[READ_WORKSPACE_STATE_TOOL]).toBeDefined();
    expect(tools[POST_DAILY_BRIEF_TOOL]).toBeDefined();
  });

  it.each([null, undefined, "insights", "lead-engine", "social-media", AD_MONITOR_PACKAGE])(
    "offers neither tool to a %s Schedule",
    (packageSlug) => {
      const tools = selectCronOperatorTools({ ...args, packageSlug });
      expect(tools[READ_WORKSPACE_STATE_TOOL]).toBeUndefined();
      expect(tools[POST_DAILY_BRIEF_TOOL]).toBeUndefined();
    },
  );

  it("offers readAdState and postAdBrief to an ad-monitor Schedule only", () => {
    const tools = selectCronOperatorTools({ ...args, packageSlug: AD_MONITOR_PACKAGE });
    expect(tools[READ_AD_STATE_TOOL]).toBeDefined();
    expect(tools[POST_AD_BRIEF_TOOL]).toBeDefined();
  });

  it.each([DAILY_MANAGER_PACKAGE, "insights", "lead-engine", "social-media", null, undefined])(
    "offers no ad tool to a %s Schedule",
    (packageSlug) => {
      const tools = selectCronOperatorTools({ ...args, packageSlug });
      expect(tools[READ_AD_STATE_TOOL]).toBeUndefined();
      expect(tools[POST_AD_BRIEF_TOOL]).toBeUndefined();
    },
  );
});

describe("postDailyBrief validation", () => {
  it.each([
    ["an empty summary", { summary: " ", items: [item(1)] }],
    ["a summary over 600 chars", { summary: "x".repeat(601), items: [item(1)] }],
    ["no items", { summary: "Quiet day.", items: [] }],
    [
      "too many items",
      {
        summary: "Busy day.",
        items: Array.from({ length: DAILY_BRIEF_MAX_ITEMS + 1 }, (_, i) => item(i + 1)),
      },
    ],
    ["a duplicate rank", { summary: "Day.", items: [item(1), item(1)] }],
    ["a rank gap", { summary: "Day.", items: [item(1), item(3)] }],
    ["an unknown kind", { summary: "Day.", items: [item(1, { kind: "send" })] }],
    ["a title over 120 chars", { summary: "Day.", items: [item(1, { title: "t".repeat(121) })] }],
    ["a why over 300 chars", { summary: "Day.", items: [item(1, { why: "w".repeat(301) })] }],
    ["an external href", { summary: "Day.", items: [item(1, { href: "https://evil.example" })] }],
    ["a protocol-relative href", { summary: "Day.", items: [item(1, { href: "//evil.example" })] }],
  ])("refuses %s without writing", async (_label, input) => {
    const result = await executePostDailyBrief(run, input);
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("error", expect.any(String));
  });
});

/**
 * An executor that answers each `select` with the next queued rows and records
 * every insert. Order of selects in `executePostDailyBrief`: task ownership
 * (only when an item has a taskId), company timezone, today's earlier brief.
 */
function stubExecutor(selects: unknown[][]) {
  const inserts: Array<{ items: DailyBriefItem[]; localDate: string }> = [];
  const query = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const step of ["from", "where", "leftJoin", "orderBy", "limit"]) q[step] = () => q;
    q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return q;
  };
  const executor = {
    select: () => query(selects.shift() ?? []),
    insert: () => ({
      values: (values: { items: DailyBriefItem[]; localDate: string }) => {
        inserts.push(values);
        return {
          onConflictDoUpdate: () => ({
            returning: async () => [{ id: "brief-1", localDate: values.localDate }],
          }),
        };
      },
    }),
  };
  return { executor: executor as unknown as ReportExecutor, inserts, selects };
}

const TASK_A = "880e8400-e29b-41d4-a716-446655440003";
const TASK_B = "990e8400-e29b-41d4-a716-446655440004";
const FOREIGN = "aa0e8400-e29b-41d4-a716-446655440005";
const MORNING = new Date("2026-11-05T06:00:00Z");

describe("postDailyBrief taskId", () => {
  it("refuses a taskId that is not a uuid without writing", async () => {
    const { executor, inserts } = stubExecutor([]);
    const result = await executePostDailyBrief(
      run,
      { summary: "Day.", items: [item(1, { taskId: "task-1" })] },
      MORNING,
      executor,
    );
    expect(result.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("refuses a taskId outside the run's company with an error text and no write", async () => {
    // Ownership query finds only TASK_A among the posted ids.
    const { executor, inserts } = stubExecutor([[{ id: TASK_A }]]);
    const result = await executePostDailyBrief(
      run,
      { summary: "Day.", items: [item(1, { taskId: TASK_A }), item(2, { taskId: FOREIGN })] },
      MORNING,
      executor,
    );
    expect(result).toEqual({ ok: false, error: expect.stringContaining(FOREIGN) });
    expect(inserts).toHaveLength(0);
  });

  it("fills the task href, stores status open and keeps an earlier same-day status", async () => {
    const { executor, inserts, selects } = stubExecutor([
      [{ id: TASK_A }, { id: TASK_B }],
      [{ timezone: "Europe/Istanbul" }],
      [
        {
          items: [
            { ...item(1), taskId: TASK_A, status: "dismissed" },
            { ...item(2), taskId: null, status: "done" },
          ],
        },
      ],
    ]);
    const result = await executePostDailyBrief(
      run,
      {
        summary: "Three things.",
        items: [
          item(3),
          item(1, { taskId: TASK_A, href: null }),
          item(2, { taskId: TASK_B, href: undefined }),
        ],
      },
      MORNING,
      executor,
    );
    expect(result).toEqual({ ok: true, briefId: "brief-1", localDate: "2026-11-05" });
    expect(selects).toHaveLength(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].items).toEqual([
      { ...item(1), href: taskHref(TASK_A), taskId: TASK_A, status: "dismissed" },
      { ...item(2), href: taskHref(TASK_B), taskId: TASK_B, status: "open" },
      { ...item(3), taskId: null, status: "open" },
    ]);
  });

  it("keeps an explicit href on a task item", async () => {
    const { executor, inserts } = stubExecutor([
      [{ id: TASK_A }],
      [{ timezone: "UTC" }],
      [],
    ]);
    await executePostDailyBrief(
      run,
      { summary: "One.", items: [item(1, { taskId: TASK_A, href: "/needs-you" })] },
      MORNING,
      executor,
    );
    expect(inserts[0].items[0]).toMatchObject({ href: "/needs-you", taskId: TASK_A, status: "open" });
  });
});

describe("postDailyBrief merge with the ad brief", () => {
  const ad = (rank: number, proposalKey: string | null = null) => ({
    ...item(rank, { title: `Ad ${rank}`, href: "/analytics/spend" }),
    proposalKey,
    source: "ads" as const,
    status: "open" as const,
  });

  it("keeps earlier ad items first, trims manager items to the cap and renumbers ranks", async () => {
    const earlier = [ad(1, "pause_channel:google"), ad(2), { ...item(3), taskId: null, status: "done" }];
    const { executor, inserts } = stubExecutor([[{ timezone: "Europe/Istanbul" }], [{ items: earlier }]]);
    const result = await executePostDailyBrief(
      run,
      { summary: "Manager day.", items: [item(1), item(2), item(3), item(4)] },
      MORNING,
      executor,
    );
    expect(result).toMatchObject({ ok: true });
    expect(inserts[0].items).toHaveLength(DAILY_BRIEF_MAX_ITEMS);
    expect(inserts[0].items).toEqual([
      ad(1, "pause_channel:google"),
      ad(2),
      { ...item(3, { title: "Item 1" }), taskId: null, status: "open" },
      { ...item(4, { title: "Item 2" }), taskId: null, status: "open" },
      { ...item(5, { title: "Item 3" }), taskId: null, status: "open" },
    ]);
  });

  it("keeps a reader status on a kept ad item", async () => {
    const earlier = [{ ...ad(1, "pause_channel:google"), status: "dismissed" as const }];
    const { executor, inserts } = stubExecutor([[{ timezone: "UTC" }], [{ items: earlier }]]);
    await executePostDailyBrief(run, { summary: "Day.", items: [item(1)] }, MORNING, executor);
    expect(inserts[0].items.map((i) => [i.rank, i.source ?? null, i.status])).toEqual([
      [1, "ads", "dismissed"],
      [2, null, "open"],
    ]);
  });
});

describe.skipIf(!E2E_ADMIN_URL)("postDailyBrief upsert (e2e)", () => {
  let database: E2eDatabase;
  let client: postgres.Sql;
  let edb: ReturnType<typeof drizzle<typeof schema>>;
  let seeded = run;

  // Creating and migrating a fresh database takes longer than the default hook timeout.
  beforeAll(async () => {
    database = await createE2eDatabase();
    client = postgres(database.url, { max: 2, onnotice: () => undefined });
    edb = drizzle(client, { schema });
    await edb
      .insert(schema.users)
      .values({ id: "owner-db", name: "Owner", email: "owner-db@example.com" });
    const [company] = await edb
      .insert(schema.companies)
      .values({ name: "Koleva", ownerId: "owner-db", timezone: "Europe/Istanbul" })
      .returning({ id: schema.companies.id });
    const [agent] = await edb
      .insert(schema.agents)
      .values({ name: "Daily Manager", companyId: company.id, kind: "operator" })
      .returning({ id: schema.agents.id });
    const [version] = await edb
      .insert(schema.agentVersions)
      .values({ agentId: agent.id, name: "v1" })
      .returning({ id: schema.agentVersions.id });
    const [job] = await edb
      .insert(schema.cronJobs)
      .values({
        companyId: company.id,
        agentId: agent.id,
        versionId: version.id,
        name: "Morning brief",
        prompt: "Brief me.",
        scheduleKind: "daily",
        timeOfDay: 510,
        packageSlug: "manager",
        nextFireAt: new Date(),
      })
      .returning({ id: schema.cronJobs.id });
    const [cronRun] = await edb
      .insert(schema.cronRuns)
      .values({ jobId: job.id, status: "running", fireAt: new Date() })
      .returning({ id: schema.cronRuns.id });
    seeded = { companyId: company.id, agentId: agent.id, cronRunId: cronRun.id };
  }, 60_000);

  afterAll(async () => {
    if (client) await client.end();
    if (database) await database.drop();
  });

  it("keeps one row per company-local date and marks a replaced brief unread", async () => {
    // 22:30Z on Oct 21 is already Oct 22 in Istanbul (UTC+3).
    const first = await executePostDailyBrief(
      seeded,
      { summary: "Two things today.", items: [item(2), item(1, { kind: "setup", href: null })] },
      new Date("2026-10-21T22:30:00Z"),
      edb,
    );
    expect(first).toMatchObject({ ok: true, localDate: "2026-10-22" });
    if (!first.ok) throw new Error(first.error);

    await edb
      .update(schema.dailyBriefs)
      .set({ readAt: new Date() })
      .where(eq(schema.dailyBriefs.id, first.briefId));

    const second = await executePostDailyBrief(
      seeded,
      { summary: "One thing now.", items: [item(1, { kind: "decide" })] },
      new Date("2026-10-22T09:00:00Z"),
      edb,
    );
    expect(second).toEqual({ ok: true, briefId: first.briefId, localDate: "2026-10-22" });

    const rows = await edb
      .select()
      .from(schema.dailyBriefs)
      .where(eq(schema.dailyBriefs.companyId, seeded.companyId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      summary: "One thing now.",
      items: [item(1, { kind: "decide" })],
      readAt: null,
    });
  });

  it("stores items in rank order and starts a new row the next local day", async () => {
    const next = await executePostDailyBrief(
      seeded,
      { summary: "Next day.", items: [item(2), item(1)] },
      new Date("2026-10-22T21:30:00Z"),
      edb,
    );
    expect(next).toMatchObject({ ok: true, localDate: "2026-10-23" });
    const [row] = await edb
      .select()
      .from(schema.dailyBriefs)
      .where(eq(schema.dailyBriefs.localDate, "2026-10-23"));
    expect(row.items.map((i) => i.rank)).toEqual([1, 2]);
  });
});
