import { and, eq, gte, inArray, lt } from "drizzle-orm";

import { listTasks } from "@relay/agent-ops/operator/tasks";

import { db } from "@/db";
import { agents, cronJobs, cronRuns, dailyBriefs, packageInstalls } from "@/db/schema";
import { localDateLabel } from "@relay/db/report-snapshots";
import type { HomeTileKey, PagePermissions } from "@relay/db/schema";
import type { WorkflowView } from "@/lib/fixtures/interfaces";
import { loadAdReport } from "@/lib/ads/ad-report-query";
import type { AdReportModel } from "@/lib/ads/ad-report-model";
import { getCompanyKpis, workflowsReader, type CompanyKpis } from "@/lib/metrics";
import { getNeedsYou, type NeedsYouList } from "@/lib/operator/needs-you";
import { localDayRange } from "@/lib/time";

import type { AgentMapModel } from "../_agent-map/agent-map-model";
import { loadAgentMap } from "../_agent-map/load-agent-map";
import { loadSessionTargets } from "../../operator/_overview/load-overview";
import type { SessionTargetGroup } from "../../operator/_overview/overview-model";
import {
  buildMyTasksTile,
  pickLeadWorkflow,
  type HomeBrief,
  type MyTasksTileModel,
  type TodayJob,
  type TodayRun,
} from "./home-model";
import { homeTilesReader } from "./load-tiles";

export type HomeData = {
  tiles: HomeTileKey[];
  /** The company has no agents yet: Home shows the set-up steps (04 `home/empty`). */
  empty: boolean;
  hasCustomerAgent: boolean;
  needsYou: NeedsYouList | null;
  kpis: CompanyKpis | null;
  /** Weekly qualified-lead target; null when no workflow sets one. */
  leadTarget: number | null;
  leadWorkflow: WorkflowView | null;
  workflowCount: number;
  /** Agent map tile (S38); null when hidden or empty. */
  agentMap: AgentMapModel | null;
  today: { jobs: TodayJob[]; runs: TodayRun[]; day: { from: Date; to: Date } } | null;
  /** Daily brief tile; null when hidden or empty. `brief` is today's, else null. */
  brief: { brief: HomeBrief | null; managerInstalled: boolean } | null;
  /** My tasks tile; null when hidden or the viewer lacks Operator access. */
  myTasks: MyTasksTileModel | null;
  /** Koleva reklam tile; null when hidden or the company has no ad data yet (the tile shows its empty state). */
  adReport: AdReportModel | null;
  /** New-session dialog groups; null when the viewer has no Operator access. */
  sessionTargets: SessionTargetGroup[] | null;
};

async function loadToday(companyId: string, now: Date, timeZone: string) {
  const day = localDayRange(now, timeZone);
  const jobRows = await db
    .select({
      id: cronJobs.id,
      name: cronJobs.name,
      enabled: cronJobs.enabled,
      nextFireAt: cronJobs.nextFireAt,
      agentName: agents.name,
    })
    .from(cronJobs)
    .innerJoin(agents, eq(agents.id, cronJobs.agentId))
    .where(eq(cronJobs.companyId, companyId));
  const runs =
    jobRows.length === 0
      ? []
      : await db
          .select({
            id: cronRuns.id,
            jobId: cronRuns.jobId,
            status: cronRuns.status,
            fireAt: cronRuns.fireAt,
            error: cronRuns.error,
          })
          .from(cronRuns)
          .where(
            and(
              inArray(
                cronRuns.jobId,
                jobRows.map((j) => j.id),
              ),
              gte(cronRuns.fireAt, day.from),
              lt(cronRuns.fireAt, day.to),
            ),
          );
  return { jobs: jobRows, runs, day };
}

/** Today's brief (company-local date) and whether Daily manager or Ad monitor is installed. */
async function loadBrief(companyId: string, now: Date, timeZone: string) {
  const [brief, install] = await Promise.all([
    db.query.dailyBriefs.findFirst({
      columns: { id: true, localDate: true, summary: true, items: true, readAt: true, createdAt: true },
      where: and(eq(dailyBriefs.companyId, companyId), eq(dailyBriefs.localDate, localDateLabel(now, timeZone))),
    }),
    db.query.packageInstalls.findFirst({
      columns: { id: true },
      // The Ad monitor writes into the same brief, so either install shows it (RL7).
      where: and(
        eq(packageInstalls.companyId, companyId),
        inArray(packageInstalls.packageSlug, ["manager", "ad-monitor"]),
      ),
    }),
  ]);
  return { brief: brief ?? null, managerInstalled: install != null };
}

/**
 * The viewer's open and doing tasks in this company, through agent-ops
 * `listTasks` (done excluded), projected and ordered against the company-local
 * today.
 */
async function loadMyTasks(viewerId: string, companyId: string, now: Date, timeZone: string) {
  const rows = await listTasks(viewerId, { companyId, assigneeUserId: viewerId });
  return buildMyTasksTile({
    tasks: rows.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, status: t.status })),
    today: localDateLabel(now, timeZone),
  });
}

/** Everything Home renders, loaded only for the tiles this viewer sees. */
export async function loadHome(args: {
  companyId: string;
  ownerId: string;
  viewerId: string;
  isOwner: boolean;
  pagePermissions: PagePermissions;
  timeZone: string;
  now: Date;
}): Promise<HomeData> {
  const { companyId, now } = args;
  const [tiles, agentRows] = await Promise.all([
    homeTilesReader.getVisibleHomeTiles(companyId, {
      isOwner: args.isOwner,
      pagePermissions: args.pagePermissions,
    }),
    db.query.agents.findMany({ where: eq(agents.companyId, companyId), columns: { id: true, kind: true } }),
  ]);
  const shows = (key: HomeTileKey) => tiles.includes(key);
  const empty = agentRows.length === 0;
  const hasCustomerAgent = agentRows.some((a) => a.kind === "customer");
  const canOperate = args.isOwner || args.pagePermissions.operator;

  const [needsYou, kpis, workflows, today, brief, myTasks, adReport] = await Promise.all([
    shows("needs_you") && !empty
      ? getNeedsYou({ companyId, viewerId: args.viewerId, ownerId: args.ownerId })
      : null,
    shows("goal_strip") && !empty ? getCompanyKpis(companyId, now) : null,
    empty ? [] : workflowsReader.listWorkflows(companyId),
    shows("today") && !empty ? loadToday(companyId, now, args.timeZone) : null,
    shows("daily_brief") && !empty ? loadBrief(companyId, now, args.timeZone) : null,
    shows("my_tasks") ? loadMyTasks(args.viewerId, companyId, now, args.timeZone) : null,
    shows("ad_report") ? loadAdReport({ companyId, now, timeZone: args.timeZone }) : null,
  ]);
  const [sessionTargets, agentMap] = await Promise.all([
    canOperate && !empty ? loadSessionTargets(companyId, workflows) : null,
    shows("agent_map") && !empty ? loadAgentMap(companyId, workflows) : null,
  ]);
  const leadWorkflow = pickLeadWorkflow(workflows);
  const targetWorkflow = workflows.find((w) => w.target?.metricKey === "leads.qualified_delivered");

  return {
    tiles,
    empty,
    hasCustomerAgent,
    needsYou,
    kpis,
    leadTarget: targetWorkflow?.target?.weeklyTarget ?? null,
    leadWorkflow: shows("lead_engine") ? leadWorkflow : null,
    workflowCount: workflows.length,
    agentMap,
    today,
    brief,
    myTasks,
    adReport,
    sessionTargets,
  };
}
