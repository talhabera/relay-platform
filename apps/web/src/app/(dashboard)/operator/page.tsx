import { and, count, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  agentVersions,
  chats,
  companyRecords,
  cronJobs,
  cronRunMessages,
  cronRuns,
  operatorAgentEditors,
  checkpoints,
  userPreferences,
} from "@/db/schema";
import { computeNextFireAt, type CronSchedule, type IntervalMinutes } from "@relay/db";
import { requireSession } from "@/lib/auth-server";
import {
  listAccessibleCompanies,
  resolveActiveCompanyId,
} from "@/lib/operator/companies";
import {
  requireCompanyMembership,
  requireOperatorAgentAccess,
} from "@/lib/operator/access";
import { resolvePagePermissions } from "@/lib/page-access";
import { getChatHistory } from "@/lib/ai/chat-persistence";
import { dbMessagesToUIMessages } from "@/lib/operator/messages";
import { cronRunMessagesToUIMessages } from "@/lib/operator/cron-messages";
import { filterOperatorHubSessions } from "@/lib/operator/list-operator-hub-sessions";
import { PageHeader } from "@/components/shared/page-header";
import { NoCompanyState, PageRestricted, SystemStateFrame } from "@/components/v2/shell";
import { OperatorHub } from "@/components/operator/operator-hub";
import { OperatorChat } from "@/components/operator/operator-chat";
import {
  sessionHeaderModel,
  versionPill,
} from "@/components/operator/operator-chat-model";
import { countSessionNeedsYou } from "@/lib/operator/needs-you";
import { OperatorCronTab } from "@/components/operator/operator-cron-tab";
import { OperatorPipelineTab } from "@/components/operator/operator-pipeline-tab";
import { LeadsPane } from "@/components/operator/session/panes/leads/leads-pane";
import {
  hasLeadsPane,
  loadLeadsPane,
} from "@/components/operator/session/panes/leads/load-leads-pane";
import { MailPane } from "@/components/operator/session/panes/mail/mail-pane";
import {
  hasMailPane,
  loadMailPane,
} from "@/components/operator/session/panes/mail/load-mail-pane";
import { CalendarPane } from "@/components/operator/session/panes/calendar/calendar-pane";
import {
  hasCalendarPane,
  loadCalendarPane,
} from "@/components/operator/session/panes/calendar/load-calendar-pane";
import { ReviewsPane } from "@/components/operator/session/panes/reviews/reviews-pane";
import {
  hasReviewsPane,
  loadReviewsPane,
} from "@/components/operator/session/panes/reviews/load-reviews-pane";
import { loadSessionQuestions } from "./_session/load-questions";
import { isWorkerRunActive } from "@/lib/worker-proxy";
import { OperatorSubnav } from "./_components/operator-subnav";
import { loadOperatorSessions } from "./_sessions/load-sessions";
import { SessionsFilterControls } from "./_sessions/sessions-filter-controls";
import {
  SESSION_RANGES,
  filterSessions,
  parseSessionsFilters,
  rangeLabel,
  resolveOperatorTab,
  safeTimeZone,
  sessionsInRange,
  timeZoneLabel,
  type SessionRange,
} from "./_sessions/sessions-list";
import { SessionsView } from "./_sessions/sessions-view";
import { RunView } from "./_sessions/run-view";
import { loadTasksTab } from "./_tasks/load-tasks";
import { TasksTab } from "./_tasks/tasks-tab";
import { localTodayString } from "./_tasks/task-groups";
import { loadOperatorOverview, loadSessionTargets } from "./_overview/load-overview";
import { WorkflowsCanvas } from "./_overview/workflows-canvas";
import { NewSessionDialog } from "./_overview/new-session-dialog";
import { OperatorOverview } from "./_overview/overview-view";

type SearchParams = Promise<{
  tab?: string;
  jobId?: string;
  runId?: string;
  agentId?: string;
  versionId?: string;
  chatId?: string;
  // Tasks tab: `task` opens the detail panel for that task.
  task?: string;
  // Sessions tab filters.
  status?: string;
  workflow?: string;
  agent?: string;
  range?: string;
  q?: string;
}>;

async function canUserEditAgent(
  userId: string,
  agent: { id: string; createdByUserId: string | null },
): Promise<boolean> {
  if (agent.createdByUserId === userId) return true;

  const editor = await db.query.operatorAgentEditors.findFirst({
    where: and(
      eq(operatorAgentEditors.agentId, agent.id),
      eq(operatorAgentEditors.userId, userId),
    ),
  });

  return editor?.canEdit === true;
}

export default async function OperatorPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const activeTab = resolveOperatorTab(params.tab);

  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, session.user.id))
    .limit(1);

  const accessibleCompanies = await listAccessibleCompanies(session.user.id);
  const activeCompanyId = resolveActiveCompanyId(
    prefs?.activeCompanyId,
    accessibleCompanies,
  );

  if (!activeCompanyId) {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={accessibleCompanies.some((c) => c.ownerId === session.user.id)} />
      </SystemStateFrame>
    );
  }

  const activeCompany = accessibleCompanies.find(
    (company) => company.id === activeCompanyId,
  );
  if (!activeCompany) {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={accessibleCompanies.some((c) => c.ownerId === session.user.id)} />
      </SystemStateFrame>
    );
  }

  await requireCompanyMembership(activeCompanyId);

  const permissions = await resolvePagePermissions(
    session.user.id,
    activeCompany,
  );
  if (!permissions.operator) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Operator"
          description="Internal agents, versions, and sessions."
        />
        <div className="flex justify-center">
          <PageRestricted
            title="Operator isn't available"
            description="Ask an owner to grant you Operator access for this company."
          />
        </div>
      </div>
    );
  }

  const subnav = <OperatorSubnav active={activeTab} />;

  // A Schedule run is a session: Sessions lists it and `?runId=` opens it.
  if (params.runId) {
    const run = await db.query.cronRuns.findFirst({
      where: eq(cronRuns.id, params.runId),
      with: { job: { with: { agent: { columns: { name: true } } } } },
    });
    if (run && run.job.companyId === activeCompanyId) {
      const messages = await db.query.cronRunMessages.findMany({
        where: eq(cronRunMessages.runId, run.id),
        orderBy: (m, { asc }) => [asc(m.createdAt)],
      });
      return (
        <div className="flex flex-col gap-2">
          <OperatorSubnav active="sessions" />
          <RunView
            run={{ id: run.id, status: run.status, fireAt: run.fireAt.toISOString(), error: run.error }}
            job={{
              id: run.job.id,
              name: run.job.name,
              agentName: run.job.agent?.name ?? "Deleted agent",
              timezone: safeTimeZone(run.job.timezone),
            }}
            messages={cronRunMessagesToUIMessages(messages)}
          />
        </div>
      );
    }
  }

  // Overview (S40). Legacy ?agentId / ?versionId / ?chatId links still open
  // the workbench below until the session layout lands (S42).
  const legacyHub = Boolean(params.agentId || params.versionId || params.chatId);
  if (activeTab === "overview" && !legacyHub) {
    const now = new Date();
    const timeZone = safeTimeZone(activeCompany.timezone);
    const data = await loadOperatorOverview({
      companyId: activeCompanyId,
      viewerId: session.user.id,
      ownerId: activeCompany.ownerId,
      now,
    });
    return (
      <div className="flex flex-col gap-2">
        {subnav}
        <OperatorOverview
          companyName={activeCompany.name}
          timeZone={timeZone}
          now={now}
          needsYou={data.needsYou}
          kpis={data.kpis}
          leadTarget={data.leadTarget}
          recent={data.recent}
          totalSessions={data.totalSessions}
          newSession={<NewSessionDialog groups={data.targets} className="shrink-0" />}
          canvas={<WorkflowsCanvas lanes={data.lanes} />}
        />
      </div>
    );
  }

  if (activeTab === "tasks") {
    const now = new Date();
    const timeZone = safeTimeZone(activeCompany.timezone);
    const data = await loadTasksTab({
      userId: session.user.id,
      companyId: activeCompanyId,
      ownerId: activeCompany.ownerId,
    });
    const selectedTaskId =
      params.task && data.tasks.some((task) => task.id === params.task)
        ? params.task
        : null;

    return (
      <div className="space-y-6">
        {subnav}
        <TasksTab
          companyId={activeCompanyId}
          timeZone={timeZone}
          today={localTodayString(now, timeZone)}
          tasks={data.tasks}
          projects={data.projects}
          assignees={data.assignees}
          selectedTaskId={selectedTaskId}
        />
      </div>
    );
  }

  if (activeTab === "sessions") {
    const now = new Date();
    const filters = parseSessionsFilters(params);
    const [data, targets] = await Promise.all([
      loadOperatorSessions(activeCompanyId),
      loadSessionTargets(activeCompanyId),
    ]);
    const timeZone = safeTimeZone(activeCompany.timezone);
    const rangeRows = sessionsInRange(data.rows, filters.range, now);
    const rows = filterSessions(data.rows, filters, now);
    const rangeLabels = Object.fromEntries(
      SESSION_RANGES.map((range) => [range, rangeLabel(range, now, timeZone)]),
    ) as Record<SessionRange, string>;

    return (
      <div className="flex flex-col gap-2">
        {subnav}
        <SessionsView
          companyName={activeCompany.name}
          timeZone={timeZone}
          timeZoneLabel={timeZoneLabel(timeZone, now)}
          filters={filters}
          rangeRows={rangeRows}
          rows={rows}
          workflowName={data.workflows.find((w) => w.id === filters.workflowId)?.name ?? null}
          agentName={data.agents.find((a) => a.id === filters.agentId)?.name ?? null}
          now={now}
          newSession={<NewSessionDialog groups={targets} className="shrink-0" />}
          controls={
            <SessionsFilterControls
              key={filters.q}
              filters={filters}
              workflows={data.workflows}
              agents={data.agents}
              rangeLabels={rangeLabels}
            />
          }
        />
      </div>
    );
  }

  const operatorAgents = await db.query.agents.findMany({
    where: and(
      eq(agents.companyId, activeCompanyId),
      eq(agents.kind, "operator"),
    ),
    orderBy: (agents, { desc: d }) => [d(agents.createdAt)],
    columns: { id: true, name: true, createdByUserId: true, packageSlug: true },
  });

  const editableAgentIds = new Set<string>();
  for (const agent of operatorAgents) {
    if (await canUserEditAgent(session.user.id, agent)) {
      editableAgentIds.add(agent.id);
    }
  }

  if (activeTab === "cron") {
    const cronJobsRaw = await db.query.cronJobs.findMany({
      where: eq(cronJobs.companyId, activeCompanyId),
      with: {
        agent: { columns: { id: true, name: true, createdByUserId: true } },
        version: { columns: { name: true, status: true } },
        runs: {
          orderBy: [desc(cronRuns.createdAt)],
          limit: 1,
          columns: { id: true, status: true, fireAt: true, error: true },
        },
      },
      orderBy: (jobs, { asc }) => [asc(jobs.name)],
    });

    const cronJobList = await Promise.all(
      cronJobsRaw.map(async (job) => ({
        id: job.id,
        name: job.name,
        agentId: job.agentId,
        agentName: job.agent?.name ?? "Unknown agent",
        versionId: job.versionId,
        prompt: job.prompt,
        enabled: job.enabled,
        scheduleKind: job.scheduleKind,
        intervalMinutes: job.intervalMinutes,
        weekday: job.weekday,
        timeOfDay: job.timeOfDay,
        timezone: job.timezone,
        latestStatus: job.runs[0]?.status ?? null,
        canEdit: editableAgentIds.has(job.agentId),
        versionName: job.version?.name ?? null,
        versionStatus: job.version?.status ?? null,
        nextFireAt: job.enabled ? job.nextFireAt.toISOString() : null,
        lastRun: job.runs[0]
          ? {
              id: job.runs[0].id,
              status: job.runs[0].status,
              fireAt: job.runs[0].fireAt.toISOString(),
              error: job.runs[0].error,
            }
          : null,
      })),
    );

    // Schedules list by default; `jobId` opens the editor sheet (Figma 05 schedules/editor).
    const selectedJobId =
      params.jobId && cronJobList.some((job) => job.id === params.jobId)
        ? params.jobId
        : null;

    const selectedJob = cronJobList.find((job) => job.id === selectedJobId);
    const nextRuns: string[] = [];
    if (selectedJob?.nextFireAt) {
      const schedule = {
        kind: selectedJob.scheduleKind,
        intervalMinutes: (selectedJob.intervalMinutes ?? 30) as IntervalMinutes,
        timeOfDay: selectedJob.timeOfDay ?? 0,
        weekday: selectedJob.weekday ?? 0,
        timezone: selectedJob.timezone,
      } as CronSchedule;
      let at = new Date(selectedJob.nextFireAt);
      try {
        for (let i = 0; i < 3; i++) {
          nextRuns.push(at.toISOString());
          at = computeNextFireAt(schedule, at);
        }
      } catch {
        // Invalid stored timezone: show only the stored next fire time.
      }
    }
    const versionsForSelectedJob = selectedJob
      ? await db.query.agentVersions.findMany({
          where: eq(agentVersions.agentId, selectedJob.agentId),
          orderBy: (versions, { desc: d }) => [d(versions.createdAt)],
          columns: { id: true, name: true },
        })
      : [];

    const editableAgents = await Promise.all(
      operatorAgents
        .filter((agent) => editableAgentIds.has(agent.id))
        .map(async (agent) => ({
          id: agent.id,
          name: agent.name,
          versions: await db.query.agentVersions.findMany({
            where: eq(agentVersions.agentId, agent.id),
            orderBy: (versions, { desc: d }) => [d(versions.createdAt)],
            columns: { id: true, name: true },
          }),
        })),
    );

    return (
      <div className="space-y-6">
        {subnav}
        <OperatorCronTab
          jobs={cronJobList}
          selectedJobId={selectedJobId}
          editableAgents={editableAgents}
          versionsForSelectedJob={versionsForSelectedJob}
          nextRuns={nextRuns}
        />
      </div>
    );
  }

  if (activeTab === "pipeline") {
    const records = await db.query.companyRecords.findMany({
      where: eq(companyRecords.companyId, activeCompanyId),
      with: {
        checkpoints: true,
      },
      orderBy: [desc(companyRecords.updatedAt)],
    });

    return (
      <div className="space-y-6">
        {subnav}
        <PageHeader
          title="Pipeline"
          description="Company memory for named accounts."
        />
        
        <OperatorPipelineTab
          rows={records.map((record) => {
            const latest = [...record.checkpoints].sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            )[0];
            return {
              id: record.id,
              name: record.name,
              domain: record.domain,
              score: record.score,
              status: record.status,
              nextFollowUpAt: record.nextFollowUpAt?.toISOString() ?? null,
              pendingCount: record.checkpoints.filter(
                (action) => action.status === "pending",
              ).length,
              payload: record.payload,
              latestAction: latest
                ? {
                    status: latest.status,
                    body: "body" in latest.payload ? latest.payload.body : "",
                  }
                : null,
            };
          })}
        />
      </div>
    );
  }

  // Needs you links carry agentId&chatId without versionId: take the agent and
  // version from the chat itself (only when it is one of this company's agents).
  const linkedChat = params.chatId
    ? await db.query.chats.findFirst({
        where: and(eq(chats.id, params.chatId), eq(chats.channelType, "operator")),
        columns: { agentId: true, versionId: true },
      })
    : undefined;
  const linked =
    linkedChat?.agentId &&
    operatorAgents.some((agent) => agent.id === linkedChat.agentId) &&
    (!params.agentId || params.agentId === linkedChat.agentId)
      ? linkedChat
      : null;

  const selectedAgentId =
    params.agentId &&
    operatorAgents.some((agent) => agent.id === params.agentId)
      ? params.agentId
      : (linked?.agentId ?? operatorAgents[0]?.id ?? null);

  const versions = selectedAgentId
    ? await db.query.agentVersions.findMany({
        where: eq(agentVersions.agentId, selectedAgentId),
        orderBy: (agentVersions, { desc: d }) => [d(agentVersions.createdAt)],
        columns: { id: true, name: true, status: true },
      })
    : [];

  const selectedVersionId =
    params.versionId && versions.some((version) => version.id === params.versionId)
      ? params.versionId
      : linked?.versionId && versions.some((version) => version.id === linked.versionId)
        ? linked.versionId
        : (versions[0]?.id ?? null);

  const sessionsRaw =
    selectedAgentId && selectedVersionId
      ? await db.query.chats.findMany({
          where: and(
            eq(chats.agentId, selectedAgentId),
            eq(chats.versionId, selectedVersionId),
            eq(chats.channelType, "operator"),
          ),
          with: { user: { columns: { name: true, email: true } } },
          orderBy: [desc(chats.createdAt)],
        })
      : [];

  const sessions = filterOperatorHubSessions(sessionsRaw);

  const selectedChatId =
    params.chatId && sessions.some((chat) => chat.id === params.chatId)
      ? params.chatId
      : null;

  const canEdit = selectedAgentId
    ? editableAgentIds.has(selectedAgentId)
    : false;

  const selectedAgent = operatorAgents.find((a) => a.id === selectedAgentId);
  const selectedChat = sessions.find((chat) => chat.id === selectedChatId);

  // Session layout (S42): ?agentId&versionId&chatId opens the session itself.
  if (selectedChatId && selectedChat) {
    const timeZone = safeTimeZone(activeCompany.timezone);
    const [history, [actionCount], needsYou, questions, runActive] = await Promise.all([
      getChatHistory(selectedChatId),
      db
        .select({ value: count() })
        .from(checkpoints)
        .where(
          and(
            eq(checkpoints.chatId, selectedChatId),
            ne(checkpoints.status, "pending"),
          ),
        ),
      countSessionNeedsYou([selectedChatId]),
      loadSessionQuestions(selectedChatId, timeZone),
      isWorkerRunActive(selectedChatId),
    ]);
    const initialMessages = dbMessagesToUIMessages(history);
    const approvalSeq = actionCount?.value ?? 0;
    const version = versions.find((v) => v.id === selectedChat.versionId) ?? null;
    const agentName = selectedAgent?.name ?? "Operator Agent";
    const starterName =
      selectedChat.user?.name ?? selectedChat.user?.email ?? "Operator";
    const header = sessionHeaderModel({
      title: selectedChat.title,
      status: selectedChat.status,
      createdAt: selectedChat.createdAt,
      timeZone,
      agentName,
      version,
      needsYouCount: needsYou.get(selectedChatId) ?? 0,
    });

    // Work panes (S50 leads, S51-S54 mail / calendar / reviews). Actions need
    // the steer gate; viewers without it still see the pane read-only.
    let workPane: React.ReactNode = null;
    const canActOnAgent = () =>
      selectedAgentId
        ? requireOperatorAgentAccess(selectedAgentId).then(
            () => true,
            () => false,
          )
        : Promise.resolve(false);
    if (hasLeadsPane(selectedAgent?.packageSlug) && selectedAgentId) {
      const canAct = await canActOnAgent();
      const pane = await loadLeadsPane({
        chat: {
          id: selectedChatId,
          companyId: activeCompanyId,
          createdAt: selectedChat.createdAt,
        },
        timeZone: activeCompany.timezone,
        openQuestion: questions.some((q) => q.status === "open"),
        canAct,
      });
      workPane = <LeadsPane {...pane} />;
    } else if (hasMailPane(selectedAgent)) {
      const pane = await loadMailPane({
        companyId: activeCompanyId,
        canAct: await canActOnAgent(),
      });
      workPane = <MailPane {...pane} />;
    } else if (hasCalendarPane(selectedAgent, selectedChat.title)) {
      const pane = await loadCalendarPane({
        companyId: activeCompanyId,
        canAct: await canActOnAgent(),
      });
      workPane = <CalendarPane {...pane} />;
    } else if (hasReviewsPane(selectedAgent)) {
      // Social Media Manager sessions whose title mentions reviews land here;
      // hasCalendarPane takes the rest. repliesApproved is not derived yet.
      const pane = await loadReviewsPane({
        companyId: activeCompanyId,
        timeZone,
        canAct: await canActOnAgent(),
      });
      workPane = <ReviewsPane {...pane} />;
    }

    return (
      <OperatorChat
        key={`${selectedChatId}-${approvalSeq}`}
        chatId={selectedChatId}
        initialMessages={initialMessages}
        isStarter={selectedChat.userId === session.user.id}
        // A brief from the new-session dialog is saved as the first user
        // message; the agent picks it up when the session opens.
        autoContinueOnUserOnlyHistory
        agentName={agentName}
        packageSlug={selectedAgent?.packageSlug ?? null}
        header={header}
        versionLabel={versionPill(version)}
        starterName={starterName}
        workPane={workPane}
        questions={questions}
        runActive={runActive}
      />
    );
  }

  return (
    <div className="space-y-6">
      {subnav}
      <PageHeader
      title="Operator"
      description="Versioned operator chat for this company."
      />
      
      <OperatorHub
        companyId={activeCompanyId}
        agents={operatorAgents}
        versions={versions}
        sessions={sessions.map((chat) => ({
          id: chat.id,
          title: chat.title,
          userId: chat.userId,
          starterName: chat.user?.name ?? chat.user?.email ?? null,
        }))}
        selectedAgentId={selectedAgentId}
        selectedVersionId={selectedVersionId}
        selectedChatId={selectedChatId}
        canEdit={canEdit}
      />
    </div>
  );
}
