import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  agentVersions,
  companyMembers,
  cronJobs,
  cronRuns,
  knowledgeBase,
  operatorAgentEditors,
  users,
} from "@/db/schema";
import { requireOperatorAgentAccess } from "@/lib/operator/access";
import type { AgentVersion, KnowledgeEntry } from "@/types";

import type { AccessInput, ScheduleJobInput } from "./operator-inspector-model";

/**
 * Inspector data of the selected operator agent for any viewer with operator access
 * (`requireOperatorAgentAccess`). `canEdit` mirrors `requireOperatorAgentEdit` (agent creator or
 * `canEdit` agent user); the server actions re-check every write.
 */
export type OperatorInspectorData = {
  companyId: string;
  canEdit: boolean;
  versions: AgentVersion[];
  knowledgeEntries: KnowledgeEntry[];
  access: AccessInput;
  schedules: ScheduleJobInput[];
};

const toPerson = (u: { id: string; name: string | null; email: string }) => ({ id: u.id, name: u.name, email: u.email });

const hasOperatorPermission = (permissions: unknown) =>
  (permissions as { operator?: unknown } | null | undefined)?.operator === true;

/** Was the `/operator/agents/[id]` settings page loader; the canvas inspector tabs use it now. */
export async function loadOperatorInspector(agentId: string): Promise<OperatorInspectorData | null> {
  let session;
  let agent;
  try {
    ({ session, agent } = await requireOperatorAgentAccess(agentId));
  } catch {
    return null;
  }
  const viewerId = session.user.id;

  const [versions, knowledgeEntries, agentUsers, members, people, jobs] = await Promise.all([
    db.query.agentVersions.findMany({
      where: eq(agentVersions.agentId, agentId),
      orderBy: (v, { desc: d }) => [d(v.createdAt)],
    }),
    db.query.knowledgeBase.findMany({
      where: eq(knowledgeBase.agentId, agentId),
      orderBy: (k, { desc: d }) => [d(k.createdAt)],
    }),
    db.query.operatorAgentEditors.findMany({
      where: eq(operatorAgentEditors.agentId, agentId),
      with: { user: true },
      orderBy: (e, { asc }) => [asc(e.createdAt)],
    }),
    db.query.companyMembers.findMany({
      where: eq(companyMembers.companyId, agent.companyId),
      with: { user: true },
    }),
    db.query.users.findMany({
      where: inArray(users.id, [agent.company.ownerId, agent.createdByUserId ?? agent.company.ownerId]),
    }),
    db
      .select({
        id: cronJobs.id,
        name: cronJobs.name,
        scheduleKind: cronJobs.scheduleKind,
        intervalMinutes: cronJobs.intervalMinutes,
        weekday: cronJobs.weekday,
        timeOfDay: cronJobs.timeOfDay,
        timezone: cronJobs.timezone,
        enabled: cronJobs.enabled,
        nextFireAt: cronJobs.nextFireAt,
        versionName: agentVersions.name,
      })
      .from(cronJobs)
      .innerJoin(agentVersions, eq(agentVersions.id, cronJobs.versionId))
      .where(and(eq(cronJobs.agentId, agentId), eq(cronJobs.companyId, agent.companyId)))
      .orderBy(cronJobs.createdAt),
  ]);

  const runs =
    jobs.length === 0
      ? []
      : await db
          .select({ jobId: cronRuns.jobId, status: cronRuns.status })
          .from(cronRuns)
          .where(
            inArray(
              cronRuns.jobId,
              jobs.map((j) => j.id),
            ),
          )
          .orderBy(desc(cronRuns.fireAt));
  const latest = new Map<string, ScheduleJobInput["latestStatus"]>();
  for (const run of runs) if (!latest.has(run.jobId)) latest.set(run.jobId, run.status);

  const viewerRow = agentUsers.find((u) => u.userId === viewerId);
  const canEdit = agent.createdByUserId === viewerId || viewerRow?.canEdit === true;

  return {
    companyId: agent.companyId,
    canEdit,
    versions,
    knowledgeEntries,
    access: {
      viewerId,
      ownerId: agent.company.ownerId,
      creatorId: agent.createdByUserId,
      viewerCanEdit: canEdit,
      agentUsers: agentUsers.map((u) => ({ user: toPerson(u.user), canEdit: u.canEdit, canApprove: u.canApprove })),
      members: members.map((m) => ({
        user: toPerson(m.user),
        role: m.role,
        operator: hasOperatorPermission(m.pagePermissions),
      })),
      people: people.map(toPerson),
    },
    schedules: jobs.map((j) => ({ ...j, latestStatus: latest.get(j.id) ?? null })),
  };
}
