import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { agents, chats, checkpoints, cronJobs, cronRuns, workflowStages, workflows } from "@/db/schema";
import type { ChatStatus } from "@relay/db";

import type { SessionListRow } from "./sessions-list";

/** Newest sessions the list loads; filters run on this window. */
const SESSION_LIMIT = 500;

export type SessionsData = {
  rows: SessionListRow[];
  workflows: { id: string; name: string }[];
  agents: { id: string; name: string }[];
};

/** A Schedule run's status in session terms. */
const RUN_STATUS: Record<(typeof cronRuns.$inferSelect)["status"], ChatStatus> = {
  running: "running",
  awaiting_input: "needs_you",
  succeeded: "completed",
  failed: "failed",
};

/**
 * Company-wide operator sessions with agent, version, workflow and open
 * checkpoints. Schedule runs are sessions too: they list here, newest activity
 * first, and open their transcript.
 */
export async function loadOperatorSessions(companyId: string): Promise<SessionsData> {
  const [chatRows, runRows, operatorAgents, stages] = await Promise.all([
    db.query.chats.findMany({
      where: and(
        eq(chats.companyId, companyId),
        eq(chats.channelType, "operator"),
        isNull(chats.archivedAt),
      ),
      columns: {
        id: true,
        title: true,
        status: true,
        agentId: true,
        versionId: true,
        createdAt: true,
        lastActivityAt: true,
      },
      with: {
        user: { columns: { name: true, email: true } },
        agent: { columns: { name: true } },
        version: { columns: { name: true, status: true } },
      },
      orderBy: [desc(chats.lastActivityAt)],
      limit: SESSION_LIMIT,
    }),
    db
      .select({
        id: cronRuns.id,
        status: cronRuns.status,
        fireAt: cronRuns.fireAt,
        startedAt: cronRuns.startedAt,
        finishedAt: cronRuns.finishedAt,
        jobName: cronJobs.name,
        agentId: cronJobs.agentId,
        versionId: cronJobs.versionId,
      })
      .from(cronRuns)
      .innerJoin(cronJobs, eq(cronRuns.jobId, cronJobs.id))
      .where(eq(cronJobs.companyId, companyId))
      .orderBy(desc(cronRuns.fireAt))
      .limit(SESSION_LIMIT),
    db.query.agents.findMany({
      where: and(eq(agents.companyId, companyId), eq(agents.kind, "operator")),
      columns: { id: true, name: true },
      orderBy: (a, { asc }) => [asc(a.name)],
    }),
    db
      .select({
        workflowId: workflows.id,
        workflowName: workflows.name,
        position: workflows.position,
        stageName: workflowStages.name,
        stageOrder: workflowStages.order,
        agentId: workflowStages.agentId,
      })
      .from(workflowStages)
      .innerJoin(workflows, eq(workflowStages.workflowId, workflows.id))
      .where(eq(workflows.companyId, companyId))
      .orderBy(workflows.position, workflowStages.order),
  ]);

  const chatIds = chatRows.map((c) => c.id);
  const pending = chatIds.length
    ? await db
        .select({ chatId: checkpoints.chatId, value: count() })
        .from(checkpoints)
        .where(and(inArray(checkpoints.chatId, chatIds), eq(checkpoints.status, "pending")))
        .groupBy(checkpoints.chatId)
    : [];
  const pendingByChat = new Map(pending.map((p) => [p.chatId, p.value]));

  const runIds = runRows.map((r) => r.id);
  const versionIds = [...new Set(runRows.map((r) => r.versionId).filter((id): id is string => Boolean(id)))];
  const [pendingRuns, runVersions] = await Promise.all([
    runIds.length
      ? db
          .select({ runId: checkpoints.cronRunId, value: count() })
          .from(checkpoints)
          .where(and(inArray(checkpoints.cronRunId, runIds), eq(checkpoints.status, "pending")))
          .groupBy(checkpoints.cronRunId)
      : [],
    versionIds.length
      ? db.query.agentVersions.findMany({
          where: (v, { inArray: within }) => within(v.id, versionIds),
          columns: { id: true, name: true, status: true },
        })
      : [],
  ]);
  const pendingByRun = new Map(pendingRuns.map((p) => [p.runId, p.value]));
  const versionById = new Map(runVersions.map((v) => [v.id, v]));
  const agentNameById = new Map(operatorAgents.map((a) => [a.id, a.name]));

  const workflowList = new Map<string, string>();
  const stagesByAgent = new Map<string, { workflowId: string; label: string }[]>();
  for (const s of stages) {
    workflowList.set(s.workflowId, s.workflowName);
    if (!s.agentId) continue;
    const list = stagesByAgent.get(s.agentId) ?? [];
    list.push({ workflowId: s.workflowId, label: `${s.workflowName} · ${s.stageName}` });
    stagesByAgent.set(s.agentId, list);
  }

  const rows: SessionListRow[] = chatRows.map((chat) => {
    const agentStages = chat.agentId ? (stagesByAgent.get(chat.agentId) ?? []) : [];
    return {
      id: chat.id,
      title: chat.title ?? "Untitled session",
      status: chat.status,
      agentId: chat.agentId,
      agentName: chat.agent?.name ?? "Deleted agent",
      versionId: chat.versionId,
      versionName: chat.version?.name ?? null,
      versionStatus: chat.version?.status ?? null,
      workflowIds: [...new Set(agentStages.map((s) => s.workflowId))],
      workflowLabel: agentStages[0]?.label ?? null,
      starterName: chat.user?.name ?? chat.user?.email ?? null,
      createdAt: chat.createdAt,
      lastActivityAt: chat.lastActivityAt,
      openCheckpoints: pendingByChat.get(chat.id) ?? 0,
      runId: null,
      scheduleName: null,
    };
  });

  for (const run of runRows) {
    const agentStages = run.agentId ? (stagesByAgent.get(run.agentId) ?? []) : [];
    const version = run.versionId ? versionById.get(run.versionId) : undefined;
    rows.push({
      id: run.id,
      title: run.jobName,
      status: RUN_STATUS[run.status],
      agentId: run.agentId,
      agentName: (run.agentId && agentNameById.get(run.agentId)) || "Deleted agent",
      versionId: run.versionId,
      versionName: version?.name ?? null,
      versionStatus: version?.status ?? null,
      workflowIds: [...new Set(agentStages.map((s) => s.workflowId))],
      workflowLabel: agentStages[0]?.label ?? null,
      starterName: null,
      createdAt: run.startedAt ?? run.fireAt,
      lastActivityAt: run.finishedAt ?? run.startedAt ?? run.fireAt,
      openCheckpoints: pendingByRun.get(run.id) ?? 0,
      runId: run.id,
      scheduleName: run.jobName,
    });
  }
  rows.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());

  return {
    rows,
    workflows: [...workflowList].map(([id, name]) => ({ id, name })),
    agents: operatorAgents,
  };
}
