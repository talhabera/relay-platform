import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  agentQuestions,
  agents,
  CHECKPOINT_KINDS,
  checkpoints,
  companies,
  cronJobs,
  dailyBriefs,
  cronRuns,
  db,
  getPackageDefinition,
  handoffRequests,
  integrations,
  messages,
  missingRequiredConnectors,
  OPEN_CHECKPOINT_STATUSES,
  PACKAGE_SLUGS,
  packageInstalls,
  projects,
  tasks,
  users,
  workflows,
  type CheckpointKind,
  type DailyBriefItemStatus,
  type TaskPriority,
  type TaskStatus,
} from "@relay/db";
import {
  buildReportSnapshot,
  loadReportFacts,
  localDateLabel,
  reportPeriodRange,
  reportTimeZone,
  type ReportExecutor,
} from "@relay/db/report-snapshots";

// Daily Manager read tool (daily manager spec, unit 2): a company-scoped
// snapshot of what needs attention this morning. Every query filters by the
// run's company. It carries ids, names, counts, statuses, timestamps and
// in-app hrefs only: no config column, credential, message body or payload
// (AGENTS.md invariants 5, 9).

/** Rows per list section; counts next to a list stay exact. */
export const WORKSPACE_STATE_SECTION_LIMIT = 10;

const ERROR_PREVIEW_CHARS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

/** In-app pages the brief may link to. */
export const WORKSPACE_LINKS = {
  needsYou: "/needs-you",
  inbox: "/messaging",
  packages: "/settings/packages",
  connectors: "/settings/connectors",
} as const;

export function scheduleHref(jobId: string): string {
  return `/operator?tab=cron&jobId=${jobId}`;
}

export function taskHref(taskId: string): string {
  return `/operator?tab=tasks&task=${taskId}`;
}

export type WorkspaceState = {
  generatedAt: string;
  timezone: string;
  links: typeof WORKSPACE_LINKS;
  schedules: {
    paused: Array<{
      id: string;
      name: string;
      agentName: string | null;
      pausedReason: string | null;
      missingConnectors: string[];
      href: string;
    }>;
    pausedTotal: number;
    failedLast24h: Array<{
      runId: string;
      jobId: string;
      jobName: string;
      error: string | null;
      fireAt: string;
      href: string;
    }>;
    failedLast24hTotal: number;
  };
  needsYou: {
    openQuestions: number;
    openCheckpointsByKind: Record<CheckpointKind, number>;
  };
  inbox: { waiting: number; escalated: number };
  pipeline: Array<{ workflow: string; weeklyTarget: number; thisWeek: number }>;
  packages: { installed: string[]; notInstalled: string[] };
  connectors: Array<{ type: string; status: string | null }>;
  tasks: {
    overdue: WorkspaceTask[];
    dueToday: WorkspaceTask[];
    doing: WorkspaceTask[];
    blocked: WorkspaceTask[];
    counts: { open: number; unassigned: number; doneYesterday: number };
    projects: Array<{ name: string; open: number; overdue: number }>;
  };
  /** The most recent brief before today, with where the reader left each item. */
  lastBrief: {
    localDate: string;
    items: Array<{ title: string; taskId: string | null; status: DailyBriefItemStatus }>;
  } | null;
};

/** A task row in the snapshot: never its notes. */
export type WorkspaceTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  projectName: string | null;
  assigneeName: string | null;
  href: string;
};

function preview(error: string | null): string | null {
  if (!error) return null;
  return error.length > ERROR_PREVIEW_CHARS
    ? `${error.slice(0, ERROR_PREVIEW_CHARS - 1)}…`
    : error;
}

async function loadSchedules(
  executor: ReportExecutor,
  companyId: string,
  now: Date,
  connected: string[],
): Promise<WorkspaceState["schedules"]> {
  const pausedWhere = and(
    eq(cronJobs.companyId, companyId),
    or(eq(cronJobs.enabled, false), isNotNull(cronJobs.pausedReason)),
  );
  const failedWhere = and(
    eq(cronJobs.companyId, companyId),
    eq(cronRuns.status, "failed"),
    gte(cronRuns.fireAt, new Date(now.getTime() - DAY_MS)),
  );

  const [paused, [pausedTotal], failed, [failedTotal]] = await Promise.all([
    executor
      .select({
        id: cronJobs.id,
        name: cronJobs.name,
        agentName: agents.name,
        pausedReason: cronJobs.pausedReason,
        packageSlug: cronJobs.packageSlug,
      })
      .from(cronJobs)
      .leftJoin(agents, eq(agents.id, cronJobs.agentId))
      .where(pausedWhere)
      // Schedules waiting for a connector first: they are the ones to set up.
      .orderBy(sql`${cronJobs.pausedReason} IS NULL`, cronJobs.name)
      .limit(WORKSPACE_STATE_SECTION_LIMIT),
    executor.select({ n: count() }).from(cronJobs).where(pausedWhere),
    executor
      .select({
        runId: cronRuns.id,
        jobId: cronJobs.id,
        jobName: cronJobs.name,
        error: cronRuns.error,
        fireAt: cronRuns.fireAt,
      })
      .from(cronRuns)
      .innerJoin(cronJobs, eq(cronJobs.id, cronRuns.jobId))
      .where(failedWhere)
      .orderBy(desc(cronRuns.fireAt))
      .limit(WORKSPACE_STATE_SECTION_LIMIT),
    executor
      .select({ n: count() })
      .from(cronRuns)
      .innerJoin(cronJobs, eq(cronJobs.id, cronRuns.jobId))
      .where(failedWhere),
  ]);

  return {
    paused: paused.map((job) => {
      const definition =
        job.pausedReason === "waiting_for_connectors" && job.packageSlug
          ? getPackageDefinition(job.packageSlug)
          : null;
      return {
        id: job.id,
        name: job.name,
        agentName: job.agentName,
        pausedReason: job.pausedReason,
        missingConnectors: definition
          ? missingRequiredConnectors(definition, connected)
          : [],
        href: scheduleHref(job.id),
      };
    }),
    pausedTotal: pausedTotal?.n ?? 0,
    failedLast24h: failed.map((run) => ({
      runId: run.runId,
      jobId: run.jobId,
      jobName: run.jobName,
      error: preview(run.error),
      fireAt: run.fireAt.toISOString(),
      href: scheduleHref(run.jobId),
    })),
    failedLast24hTotal: failedTotal?.n ?? 0,
  };
}

async function loadNeedsYou(
  executor: ReportExecutor,
  companyId: string,
): Promise<WorkspaceState["needsYou"]> {
  const [[questions], byKind] = await Promise.all([
    executor
      .select({ n: count() })
      .from(agentQuestions)
      .where(
        and(eq(agentQuestions.companyId, companyId), eq(agentQuestions.status, "open")),
      ),
    executor
      .select({ kind: checkpoints.kind, n: count() })
      .from(checkpoints)
      .where(
        and(
          eq(checkpoints.companyId, companyId),
          inArray(checkpoints.status, [...OPEN_CHECKPOINT_STATUSES]),
        ),
      )
      .groupBy(checkpoints.kind),
  ]);

  const openCheckpointsByKind = Object.fromEntries(
    CHECKPOINT_KINDS.map((kind) => [kind, 0]),
  ) as Record<CheckpointKind, number>;
  for (const row of byKind) openCheckpointsByKind[row.kind] = row.n;

  return { openQuestions: questions?.n ?? 0, openCheckpointsByKind };
}

/**
 * Inbox tab counts as the Inbox reads them: Escalated is any conversation with
 * a handoff request; Waiting for you is one whose latest request expired and
 * no person has replied since.
 */
async function loadInbox(
  executor: ReportExecutor,
  companyId: string,
): Promise<WorkspaceState["inbox"]> {
  const requests = await executor
    .select({
      chatId: handoffRequests.chatId,
      status: handoffRequests.status,
      expiredAt: handoffRequests.expiredAt,
    })
    .from(handoffRequests)
    .where(eq(handoffRequests.companyId, companyId))
    .orderBy(handoffRequests.createdAt);

  const latest = new Map<string, (typeof requests)[number]>();
  for (const request of requests) latest.set(request.chatId, request);

  const expired = [...latest.values()].filter((r) => r.status === "expired");
  if (expired.length === 0) return { waiting: 0, escalated: latest.size };

  const lastHuman = await executor
    .select({
      chatId: messages.chatId,
      // Map through the column: a bare `new Date()` would read the
      // timezone-less timestamp in the process's local zone.
      at: sql<Date>`max(${messages.createdAt})`.mapWith(messages.createdAt),
    })
    .from(messages)
    .where(
      and(
        inArray(
          messages.chatId,
          expired.map((r) => r.chatId),
        ),
        eq(messages.author, "human"),
      ),
    )
    .groupBy(messages.chatId);
  const repliedAt = new Map(lastHuman.map((row) => [row.chatId, row.at]));

  const waiting = expired.filter((r) => {
    const at = repliedAt.get(r.chatId);
    return !at || !r.expiredAt || at.getTime() <= r.expiredAt.getTime();
  }).length;
  return { waiting, escalated: latest.size };
}

/** Week-to-date value of each targeted workflow's metric, as the card counts it. */
async function loadPipeline(
  executor: ReportExecutor,
  companyId: string,
  now: Date,
  timeZone: string,
): Promise<WorkspaceState["pipeline"]> {
  const targeted = await executor
    .select({
      name: workflows.name,
      weeklyTarget: workflows.weeklyTarget,
      targetMetricKey: workflows.targetMetricKey,
    })
    .from(workflows)
    .where(and(eq(workflows.companyId, companyId), isNotNull(workflows.weeklyTarget)))
    .orderBy(workflows.position)
    .limit(WORKSPACE_STATE_SECTION_LIMIT);
  if (targeted.length === 0) return [];

  const range = reportPeriodRange("weekly", now, timeZone);
  const facts = await loadReportFacts(executor, companyId, "weekly", range, timeZone);
  const { metrics } = buildReportSnapshot("weekly", range, timeZone, facts);

  return targeted.map((workflow) => ({
    workflow: workflow.name,
    weeklyTarget: workflow.weeklyTarget ?? 0,
    thisWeek:
      metrics.find((m) => m.metricKey === workflow.targetMetricKey)?.value ?? 0,
  }));
}

/** The calendar day before a `YYYY-MM-DD` label; plain date arithmetic, so DST cannot shift it. */
function previousDateLabel(label: string): string {
  const [y, m, d] = label.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * Open, overdue, due-today, doing and blocked tasks of the company. `today`
 * and `yesterday` are company-local `YYYY-MM-DD` labels; `tasks.dueDate` is
 * one too, so they compare as strings.
 */
async function loadTasks(
  executor: ReportExecutor,
  companyId: string,
  now: Date,
  timeZone: string,
  today: string,
): Promise<WorkspaceState["tasks"]> {
  const yesterday = previousDateLabel(today);
  const open = and(eq(tasks.companyId, companyId), ne(tasks.status, "done"));
  const overdueWhen = sql`(${tasks.dueDate} IS NOT NULL AND ${tasks.dueDate} < ${today})`;

  const list = (where: SQL | undefined) =>
    executor
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        projectName: projects.name,
        assigneeName: users.name,
      })
      .from(tasks)
      .leftJoin(
        projects,
        and(eq(projects.id, tasks.projectId), eq(projects.companyId, companyId)),
      )
      .leftJoin(users, eq(users.id, tasks.assigneeUserId))
      .where(where)
      .orderBy(
        sql`CASE ${tasks.priority} WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END`,
        sql`${tasks.dueDate} ASC NULLS LAST`,
        asc(tasks.createdAt),
        asc(tasks.id),
      )
      .limit(WORKSPACE_STATE_SECTION_LIMIT);

  const [overdue, dueToday, doing, blocked, [counts], completed, projectRows] =
    await Promise.all([
      list(and(open, overdueWhen)),
      list(and(open, eq(tasks.dueDate, today))),
      list(and(eq(tasks.companyId, companyId), eq(tasks.status, "doing"))),
      list(and(eq(tasks.companyId, companyId), eq(tasks.status, "blocked"))),
      executor
        .select({
          open: count(),
          unassigned: sql<number>`count(*) filter (where ${tasks.assigneeUserId} is null)`.mapWith(Number),
        })
        .from(tasks)
        .where(open),
      // A window wide enough for any zone's "yesterday"; the local date is
      // checked below, where the zone's offset and DST are applied.
      executor
        .select({ completedAt: tasks.completedAt })
        .from(tasks)
        .where(
          and(
            eq(tasks.companyId, companyId),
            eq(tasks.status, "done"),
            gte(tasks.completedAt, new Date(now.getTime() - 3 * DAY_MS)),
          ),
        ),
      executor
        .select({
          name: projects.name,
          open: sql<number>`count(${tasks.id})`.mapWith(Number),
          overdue: sql<number>`count(${tasks.id}) filter (where ${overdueWhen})`.mapWith(Number),
        })
        .from(projects)
        .leftJoin(
          tasks,
          and(
            eq(tasks.projectId, projects.id),
            eq(tasks.companyId, companyId),
            ne(tasks.status, "done"),
          ),
        )
        .where(and(eq(projects.companyId, companyId), eq(projects.status, "active")))
        .groupBy(projects.id, projects.name, projects.position)
        .orderBy(projects.position, projects.name),
    ]);

  const row = (task: (typeof overdue)[number]): WorkspaceTask => ({
    ...task,
    href: taskHref(task.id),
  });

  return {
    overdue: overdue.map(row),
    dueToday: dueToday.map(row),
    doing: doing.map(row),
    blocked: blocked.map(row),
    counts: {
      open: counts?.open ?? 0,
      unassigned: counts?.unassigned ?? 0,
      doneYesterday: completed.filter(
        (task) => task.completedAt && localDateLabel(task.completedAt, timeZone) === yesterday,
      ).length,
    },
    projects: projectRows,
  };
}

/** The company's most recent brief dated before `today` (company-local). */
async function loadLastBrief(
  executor: ReportExecutor,
  companyId: string,
  today: string,
): Promise<WorkspaceState["lastBrief"]> {
  const [brief] = await executor
    .select({ localDate: dailyBriefs.localDate, items: dailyBriefs.items })
    .from(dailyBriefs)
    .where(and(eq(dailyBriefs.companyId, companyId), lt(dailyBriefs.localDate, today)))
    .orderBy(desc(dailyBriefs.localDate))
    .limit(1);
  if (!brief) return null;
  return {
    localDate: brief.localDate,
    items: brief.items.map((item) => ({
      title: item.title,
      taskId: item.taskId ?? null,
      status: item.status ?? "open",
    })),
  };
}

export async function loadWorkspaceState(
  companyId: string,
  now: Date = new Date(),
  executor: ReportExecutor = db,
): Promise<WorkspaceState> {
  const [[company], connectorRows, installs] = await Promise.all([
    executor
      .select({ timezone: companies.timezone })
      .from(companies)
      .where(eq(companies.id, companyId)),
    // Company-level connectors only, as Settings > Connectors lists them.
    executor
      .select({ type: integrations.type, status: integrations.status })
      .from(integrations)
      .where(and(eq(integrations.companyId, companyId), isNull(integrations.agentId)))
      .orderBy(integrations.type),
    executor
      .select({ slug: packageInstalls.packageSlug })
      .from(packageInstalls)
      .where(eq(packageInstalls.companyId, companyId)),
  ]);
  const timeZone = reportTimeZone(company?.timezone);
  const connected = connectorRows
    .filter((row) => row.status === "connected")
    .map((row) => row.type);
  const installed = PACKAGE_SLUGS.filter((slug) =>
    installs.some((row) => row.slug === slug),
  );

  const today = localDateLabel(now, timeZone);

  const [schedules, needsYou, inbox, pipeline, taskState, lastBrief] = await Promise.all([
    loadSchedules(executor, companyId, now, connected),
    loadNeedsYou(executor, companyId),
    loadInbox(executor, companyId),
    loadPipeline(executor, companyId, now, timeZone),
    loadTasks(executor, companyId, now, timeZone, today),
    loadLastBrief(executor, companyId, today),
  ]);

  return {
    generatedAt: now.toISOString(),
    timezone: timeZone,
    links: WORKSPACE_LINKS,
    schedules,
    needsYou,
    inbox,
    pipeline,
    packages: {
      installed,
      notInstalled: PACKAGE_SLUGS.filter((slug) => !installed.includes(slug)),
    },
    connectors: connectorRows.slice(0, WORKSPACE_STATE_SECTION_LIMIT),
    tasks: taskState,
    lastBrief,
  };
}
