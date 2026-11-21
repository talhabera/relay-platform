import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { E2E_ADMIN_URL, useE2eDatabase, type E2eDatabase } from "../test-utils/e2e-db";

// Daily Manager briefs from tasks (koleva-work 04): readWorkspaceState carries
// the company's tasks and the last brief, and postDailyBrief links items to
// tasks of the run's company only.
//
// Company in Europe/Istanbul (UTC+3). "Now" is Thursday 2026-11-05 09:00
// local, so today is 2026-11-05 and yesterday 2026-11-04 (local).

const TZ = "Europe/Istanbul";
const NOW = new Date("2026-11-05T06:00:00Z");
const NOTE = "private note, never in the snapshot";

describe.skipIf(!E2E_ADMIN_URL)("Daily Manager over tasks (e2e)", () => {
  let database: E2eDatabase;
  let dbm: typeof import("@relay/db");
  let ws: typeof import("../operator/workspace-state");
  let brief: typeof import("../operator/daily-brief-tool");
  let run = { companyId: "", agentId: "", cronRunId: "" };
  let otherCompanyId = "";
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    database = await useE2eDatabase();
    dbm = await import("@relay/db");
    ws = await import("../operator/workspace-state");
    brief = await import("../operator/daily-brief-tool");
    const { db, users, companies, agents, agentVersions, cronJobs, cronRuns, projects, tasks, dailyBriefs } =
      dbm;

    await db.insert(users).values([
      { id: "owner-t", name: "Owner", email: "owner-t@example.com" },
      { id: "ayse-t", name: "Ayşe", email: "ayse-t@example.com" },
    ]);
    const [company, other] = await db
      .insert(companies)
      .values([
        { name: "Koleva", ownerId: "owner-t", timezone: TZ },
        { name: "Other", ownerId: "owner-t", timezone: TZ },
      ])
      .returning({ id: companies.id });
    otherCompanyId = other.id;
    const [agent] = await db
      .insert(agents)
      .values({ name: "Daily Manager", companyId: company.id, kind: "operator" })
      .returning({ id: agents.id });
    const [version] = await db
      .insert(agentVersions)
      .values({ agentId: agent.id, name: "v1" })
      .returning({ id: agentVersions.id });
    const [job] = await db
      .insert(cronJobs)
      .values({
        companyId: company.id,
        agentId: agent.id,
        versionId: version.id,
        name: "Morning brief",
        prompt: "Brief me.",
        scheduleKind: "daily",
        timeOfDay: 510,
        packageSlug: "manager",
        nextFireAt: NOW,
      })
      .returning({ id: cronJobs.id });
    const [cronRun] = await db
      .insert(cronRuns)
      .values({ jobId: job.id, status: "running", fireAt: NOW })
      .returning({ id: cronRuns.id });
    run = { companyId: company.id, agentId: agent.id, cronRunId: cronRun.id };

    const [website, archived] = await db
      .insert(projects)
      .values([
        { companyId: company.id, name: "Website", position: 0 },
        { companyId: company.id, name: "Old site", status: "archived", position: 1 },
      ])
      .returning({ id: projects.id });

    const rows = await db
      .insert(tasks)
      .values([
        {
          companyId: company.id,
          projectId: website.id,
          title: "Fix checkout",
          notes: NOTE,
          assigneeUserId: "ayse-t",
          dueDate: "2026-11-03",
        },
        { companyId: company.id, title: "Pay invoice", priority: "high", dueDate: "2026-11-04" },
        {
          companyId: company.id,
          projectId: website.id,
          title: "Ship homepage",
          status: "doing",
          dueDate: "2026-11-05",
        },
        { companyId: company.id, projectId: website.id, title: "Wait for logo", status: "blocked" },
        { companyId: company.id, projectId: archived.id, title: "Archived thing" },
        // 23:30 local on Nov 4: done yesterday.
        {
          companyId: company.id,
          title: "Send report",
          status: "done",
          dueDate: "2026-11-01",
          completedAt: new Date("2026-11-04T20:30:00Z"),
        },
        // 00:30 local on Nov 5: done today, not yesterday.
        {
          companyId: company.id,
          title: "Call supplier",
          status: "done",
          completedAt: new Date("2026-11-04T21:30:00Z"),
        },
        { companyId: other.id, title: "Other company task", dueDate: "2026-11-03" },
      ])
      .returning({ id: tasks.id, title: tasks.title });
    for (const row of rows) ids[row.title] = row.id;

    const entry = (rank: number, title: string, extra: Record<string, unknown> = {}) => ({
      rank,
      kind: "do" as const,
      title,
      why: "Because.",
      href: null,
      ...extra,
    });
    await db.insert(dailyBriefs).values([
      { companyId: company.id, localDate: "2026-11-03", summary: "Older.", items: [entry(1, "Older item")] },
      {
        companyId: company.id,
        localDate: "2026-11-04",
        summary: "Yesterday.",
        items: [
          entry(1, "Fix checkout first", { taskId: ids["Fix checkout"], status: "dismissed" }),
          // Written before items had a status.
          entry(2, "Hire a designer", { kind: "decide" }),
        ],
      },
      {
        companyId: company.id,
        localDate: "2026-11-05",
        summary: "Earlier today.",
        items: [entry(1, "Ship it", { taskId: ids["Ship homepage"], status: "done" })],
      },
      {
        companyId: other.id,
        localDate: "2026-11-04",
        summary: "Other.",
        items: [entry(1, "Other item")],
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (dbm) await dbm.db.$client.end();
    if (database) await database.drop();
  });

  async function todaysBrief() {
    const { db, dailyBriefs } = dbm;
    const [row] = await db
      .select()
      .from(dailyBriefs)
      .where(and(eq(dailyBriefs.companyId, run.companyId), eq(dailyBriefs.localDate, "2026-11-05")));
    return row;
  }

  it("lists overdue, due-today, doing and blocked tasks ranked by priority then due date", async () => {
    const { tasks: state } = await ws.loadWorkspaceState(run.companyId, NOW, dbm.db);
    expect(state.overdue.map((t) => t.title)).toEqual(["Pay invoice", "Fix checkout"]);
    expect(state.overdue[1]).toEqual({
      id: ids["Fix checkout"],
      title: "Fix checkout",
      status: "todo",
      priority: "normal",
      dueDate: "2026-11-03",
      projectName: "Website",
      assigneeName: "Ayşe",
      href: ws.taskHref(ids["Fix checkout"]),
    });
    expect(state.overdue[0]).toMatchObject({ priority: "high", projectName: null, assigneeName: null });
    expect(state.dueToday.map((t) => t.title)).toEqual(["Ship homepage"]);
    expect(state.doing.map((t) => t.title)).toEqual(["Ship homepage"]);
    expect(state.blocked.map((t) => t.title)).toEqual(["Wait for logo"]);
  });

  it("counts open, unassigned and done-yesterday tasks and each active project", async () => {
    const { tasks: state } = await ws.loadWorkspaceState(run.companyId, NOW, dbm.db);
    expect(state.counts).toEqual({ open: 5, unassigned: 4, doneYesterday: 1 });
    expect(state.projects).toEqual([{ name: "Website", open: 3, overdue: 1 }]);
  });

  it("returns the last brief before today with item statuses", async () => {
    const { lastBrief } = await ws.loadWorkspaceState(run.companyId, NOW, dbm.db);
    expect(lastBrief).toEqual({
      localDate: "2026-11-04",
      items: [
        { title: "Fix checkout first", taskId: ids["Fix checkout"], status: "dismissed" },
        { title: "Hire a designer", taskId: null, status: "open" },
      ],
    });
  });

  it("keeps notes and other companies out of the snapshot", async () => {
    const state = await ws.loadWorkspaceState(run.companyId, NOW, dbm.db);
    const text = JSON.stringify(state);
    expect(text).not.toContain(NOTE);
    expect(text).not.toContain('"notes"');
    expect(text).not.toContain("Other company task");
    expect(text).not.toContain(ids["Other company task"]);
    expect(text).not.toContain(otherCompanyId);
  });

  it("refuses a taskId from another company and writes nothing", async () => {
    const before = await todaysBrief();
    const result = await brief.executePostDailyBrief(
      run,
      {
        summary: "Foreign.",
        items: [
          { rank: 1, kind: "do", title: "Not ours", why: "Test.", href: null, taskId: ids["Other company task"] },
        ],
      },
      NOW,
      dbm.db,
    );
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    const after = await todaysBrief();
    expect(after).toEqual(before);
  });

  it("links items to tasks and keeps a matching item's status across same-day re-posts", async () => {
    const { db, dailyBriefs } = dbm;
    const first = await brief.executePostDailyBrief(
      run,
      {
        summary: "Three things.",
        items: [
          { rank: 1, kind: "do", title: "Finish the homepage", why: "Due today.", taskId: ids["Ship homepage"] },
          {
            rank: 2,
            kind: "do",
            title: "Fix checkout",
            why: "Overdue.",
            href: null,
            taskId: ids["Fix checkout"],
          },
          { rank: 3, kind: "decide", title: "Hire a designer?", why: "Logo is blocked.", href: null },
        ],
      },
      NOW,
      dbm.db,
    );
    expect(first).toMatchObject({ ok: true, localDate: "2026-11-05" });
    if (!first.ok) throw new Error(first.error);

    let row = await todaysBrief();
    expect(row.items).toEqual([
      expect.objectContaining({
        taskId: ids["Ship homepage"],
        href: ws.taskHref(ids["Ship homepage"]),
        status: "done", // kept from the earlier post today
      }),
      expect.objectContaining({
        taskId: ids["Fix checkout"],
        href: ws.taskHref(ids["Fix checkout"]),
        status: "open",
      }),
      expect.objectContaining({ taskId: null, href: null, status: "open" }),
    ]);

    // The reader dismisses the checkout item; the manager re-posts.
    await db
      .update(dailyBriefs)
      .set({ items: row.items.map((i) => (i.rank === 2 ? { ...i, status: "dismissed" as const } : i)) })
      .where(eq(dailyBriefs.id, first.briefId));
    const second = await brief.executePostDailyBrief(
      run,
      {
        summary: "Re-post.",
        items: [
          { rank: 1, kind: "do", title: "Fix checkout now", why: "Still overdue.", taskId: ids["Fix checkout"] },
          { rank: 2, kind: "do", title: "Unblock the logo", why: "Blocked.", taskId: ids["Wait for logo"] },
        ],
      },
      NOW,
      dbm.db,
    );
    expect(second).toEqual({ ok: true, briefId: first.briefId, localDate: "2026-11-05" });
    row = await todaysBrief();
    expect(row.summary).toBe("Re-post.");
    expect(row.items.map((i) => [i.taskId, i.status])).toEqual([
      [ids["Fix checkout"], "dismissed"],
      [ids["Wait for logo"], "open"],
    ]);
  });
});
