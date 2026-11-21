import { db } from "@/db";
import {
  agentQuestions,
  checkpoints,
  companyMembers,
  companyRecords,
  cronJobs,
  dailyBriefs,
  leadEvents,
  operatorAgentEditors,
} from "@/db/schema";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { canApproveCheckpoint } from "@relay/agent-ops/auth/access";
import { OPEN_CHECKPOINT_STATUSES, deriveSessionStatus } from "@relay/db";
import { localDateLabel } from "@relay/db/report-snapshots";
import type {
  CheckpointKind,
  CheckpointPayload,
  CheckpointStatus,
} from "@relay/db/schema";
import {
  listAgentWorkflows,
  listLeadWorkflowAgentIds,
} from "@/lib/workflows/read";

// Needs you: everything in operator work that waits on a person.
// Item set: checkpoints spec decision 14. Order: needs-you-ordering spec.
// Viewer filter: approve-rights spec decision 7.

export const NEEDS_YOU_TOP_N = 5;

/** Checkpoint states that are a Needs you item. `changes_requested` is not. */
export { OPEN_CHECKPOINT_STATUSES, deriveSessionStatus };
export type OpenCheckpointStatus = (typeof OPEN_CHECKPOINT_STATUSES)[number];

export type ImpactTier = 1 | 2 | 3;

/** Checkpoint kinds that hold up leads (tier 2). */
const LEAD_CHECKPOINT_KINDS: ReadonlySet<CheckpointKind> = new Set([
  "outreach",
  "lead_delivery",
]);

type ItemBase = {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  createdAt: Date;
  chatId: string | null;
  cronRunId: string | null;
  cronJobId: string | null;
};

export type NeedsYouCandidate =
  | (ItemBase & {
      type: "checkpoint";
      checkpointKind: CheckpointKind;
      checkpointStatus: OpenCheckpointStatus;
      /**
       * The card's chat is a customer conversation, not an operator session
       * (W3GAP2: lead_delivery on the lead's own chat).
       */
      onCustomerChat?: boolean;
      /** Used only by the approve predicate; never sent to the client. */
      approval: {
        agentCreatedByUserId: string | null;
        sessionUserId: string | null;
      };
    })
  | (ItemBase & {
      type: "agent_question";
      /** A customer conversation, not an operator session (agent kind not operator). */
      onCustomerChat?: boolean;
      /** Used only by the viewer filter; never sent to the client. */
      agentKind?: string | null;
    })
  | (ItemBase & {
      type: "qualified_lead";
      /** Used only by the viewer filter; never sent to the client. */
      agentKind?: string | null;
    })
  | (ItemBase & {
      type: "failed_run";
      error: string | null;
      /** Used only by the viewer filter; never sent to the client. */
      agentKind?: string | null;
    })
  | (ItemBase & {
      type: "brief";
      /** Used only by the viewer filter; never sent to the client. */
      agentKind?: string | null;
    });

/** A question, failed run or brief: items any operator-agent viewer may act on. */
export type OperatorItemCandidate = Exclude<
  NeedsYouCandidate,
  { type: "checkpoint" }
>;

export type NeedsYouItem = ItemBase & {
  type: NeedsYouCandidate["type"];
  tier: ImpactTier;
  href: string;
  /** Workflow the agent runs a stage in (row tag, list filter); null if none. */
  workflow?: string | null;
  checkpointKind?: CheckpointKind;
  checkpointStatus?: OpenCheckpointStatus;
  /** Checkpoint on a customer conversation; the /needs-you pane shows its live card. */
  onCustomerChat?: boolean;
  error?: string | null;
};

export type NeedsYouList = {
  /** Full ordered list the viewer can act on. */
  items: NeedsYouItem[];
  /** Bell count; equals items.length. */
  total: number;
};

/**
 * Impact tier by what the item holds up (ordering spec decision 1).
 * An agent in no workflow is never in a lead workflow, so it lands in tier 3.
 */
export function impactTier(
  item: NeedsYouCandidate,
  isLeadWorkflowAgent: (agentId: string) => boolean,
): ImpactTier {
  const lead = isLeadWorkflowAgent(item.agentId);
  switch (item.type) {
    case "qualified_lead":
      return 1;
    case "failed_run":
      return lead ? 1 : 3;
    case "agent_question":
      return lead ? 2 : 3;
    case "checkpoint":
      return LEAD_CHECKPOINT_KINDS.has(item.checkpointKind) ? 2 : 3;
    case "brief":
      return 3;
  }
}

/** `ORDER BY tier, created_at ASC`; id breaks exact-time ties for a stable order. */
export function compareNeedsYou(
  a: { tier: ImpactTier; createdAt: Date; id: string },
  b: { tier: ImpactTier; createdAt: Date; id: string },
): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  const dt = a.createdAt.getTime() - b.createdAt.getTime();
  if (dt !== 0) return dt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Where a brief item opens: the Daily brief tile on Home. */
export const BRIEF_HREF = "/home#brief";

export function needsYouHref(item: NeedsYouCandidate): string {
  if (item.type === "brief") return BRIEF_HREF;
  // A customer conversation has no operator session to open; its cards sit
  // on the conversation in the Inbox (S45).
  if (item.type === "checkpoint" && item.onCustomerChat && item.chatId) {
    return `/messaging?chatId=${item.chatId}`;
  }
  if (item.type === "qualified_lead" && item.chatId) {
    return `/messaging?chatId=${item.chatId}`;
  }
  if (item.type === "agent_question" && item.onCustomerChat && item.chatId) {
    return `/messaging?chatId=${item.chatId}`;
  }
  if (item.chatId) {
    return `/operator?agentId=${item.agentId}&chatId=${item.chatId}`;
  }
  if (item.cronRunId) return `/operator?runId=${item.cronRunId}`;
  if (item.cronJobId) return `/operator?tab=cron&jobId=${item.cronJobId}`;
  return `/operator?agentId=${item.agentId}`;
}

function toItem(
  c: NeedsYouCandidate,
  tier: ImpactTier,
  workflow: string | null,
): NeedsYouItem {
  const base: NeedsYouItem = {
    id: c.id,
    type: c.type,
    agentId: c.agentId,
    agentName: c.agentName,
    title: c.title,
    createdAt: c.createdAt,
    chatId: c.chatId,
    cronRunId: c.cronRunId,
    cronJobId: c.cronJobId,
    tier,
    href: needsYouHref(c),
    workflow,
  };
  if (c.type === "checkpoint") {
    base.checkpointKind = c.checkpointKind;
    base.checkpointStatus = c.checkpointStatus;
    if (c.onCustomerChat) base.onCustomerChat = true;
  }
  if (c.type === "agent_question" && c.onCustomerChat) base.onCustomerChat = true;
  if (c.type === "failed_run") base.error = c.error;
  return base;
}

/**
 * One server order, then the viewer filter: checkpoints only for the agent's
 * approvers; questions, failed runs and briefs only for viewers with operator
 * access to that agent (W5GAP). Without `canSeeOperatorItem` every one is kept.
 */
export function buildNeedsYou(args: {
  candidates: NeedsYouCandidate[];
  isLeadWorkflowAgent: (agentId: string) => boolean;
  canApproveCheckpoint: (
    item: Extract<NeedsYouCandidate, { type: "checkpoint" }>,
  ) => boolean;
  /** Questions, failed runs and briefs the viewer may see. */
  canSeeOperatorItem?: (item: OperatorItemCandidate) => boolean;
  /** Workflow name per agent, for the row tag; null when in none. */
  workflowOf?: (agentId: string) => string | null;
}): NeedsYouList {
  const workflowOf = args.workflowOf ?? (() => null);
  const canSee = args.canSeeOperatorItem ?? (() => true);
  const items = args.candidates
    .filter((c) =>
      c.type === "checkpoint" ? args.canApproveCheckpoint(c) : canSee(c),
    )
    .map((c) =>
      toItem(c, impactTier(c, args.isLeadWorkflowAgent), workflowOf(c.agentId)),
    )
    .sort(compareNeedsYou);
  return { items, total: items.length };
}

/** Home tile and bell panel show the top 5, then "View all (n)". */
export function topNeedsYou(
  list: NeedsYouList,
  n: number = NEEDS_YOU_TOP_N,
): NeedsYouList {
  return { items: list.items.slice(0, n), total: list.total };
}

// ---------------------------------------------------------------------------
// Session status and checkpoint counts (Session row, Sessions filter chips)
// ---------------------------------------------------------------------------

/** Open (pending, stale, failed) checkpoints per session, for the Session row. */
export async function countOpenCheckpointsByChat(
  chatIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (chatIds.length === 0) return counts;
  const rows = await db.query.checkpoints.findMany({
    columns: { chatId: true },
    where: and(
      inArray(checkpoints.chatId, chatIds),
      inArray(checkpoints.status, [...OPEN_CHECKPOINT_STATUSES]),
      isNull(checkpoints.supersededBy),
    ),
  });
  for (const row of rows) {
    if (!row.chatId) continue;
    counts.set(row.chatId, (counts.get(row.chatId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Session header "Needs you" count: open checkpoints plus open agent questions
 * on each session (the two things that make `chats.status` needs_you).
 */
export async function countSessionNeedsYou(
  chatIds: string[],
): Promise<Map<string, number>> {
  if (chatIds.length === 0) return new Map();
  const [counts, questions] = await Promise.all([
    countOpenCheckpointsByChat(chatIds),
    db.query.agentQuestions.findMany({
      columns: { chatId: true },
      where: and(
        inArray(agentQuestions.chatId, chatIds),
        eq(agentQuestions.status, "open"),
      ),
    }),
  ]);
  for (const row of questions) {
    if (!row.chatId) continue;
    counts.set(row.chatId, (counts.get(row.chatId) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

function checkpointTitle(
  status: CheckpointStatus,
  kind: CheckpointKind,
  payload?: CheckpointPayload,
): string {
  const label: Record<CheckpointKind, string> = {
    outreach: "Approve outreach",
    email_sequence: "Schedule email sequence",
    post: "Schedule post",
    review_reply: "Post review reply",
    lead_delivery: "Deliver lead",
    ad_change:
      payload?.kind === "ad_change" && payload.mode === "undo"
        ? "Reklam değişikliğini geri al"
        : "Reklam değişikliğini onayla",
  };
  if (status === "failed") return `${label[kind]} failed`;
  if (status === "stale") return `${label[kind]} (stale)`;
  return label[kind];
}

/** Channels of a customer conversation (not operator, not Panel Chat). */
const CUSTOMER_CHANNELS: ReadonlySet<string> = new Set([
  "whatsapp",
  "instagram",
  "telegram",
  "messenger",
  "widget",
  "web",
]);

function isCustomerChannel(channelType: string | null | undefined): boolean {
  return channelType != null && CUSTOMER_CHANNELS.has(channelType);
}

export async function loadOpenCheckpoints(
  companyId: string,
): Promise<NeedsYouCandidate[]> {
  const rows = await db.query.checkpoints.findMany({
    where: and(
      eq(checkpoints.companyId, companyId),
      inArray(checkpoints.status, [...OPEN_CHECKPOINT_STATUSES]),
      isNull(checkpoints.supersededBy),
    ),
    with: {
      agent: { columns: { id: true, name: true, createdByUserId: true } },
      chat: { columns: { id: true, userId: true, channelType: true } },
      cronRun: { columns: { id: true, jobId: true } },
    },
  });
  return rows.map((row) => ({
    type: "checkpoint" as const,
    id: row.id,
    agentId: row.agentId,
    agentName: row.agent?.name ?? "",
    title: checkpointTitle(row.status, row.kind, row.payload),
    createdAt: row.createdAt,
    chatId: row.chatId,
    cronRunId: row.cronRunId,
    cronJobId: row.cronRun?.jobId ?? null,
    checkpointKind: row.kind,
    checkpointStatus: row.status as OpenCheckpointStatus,
    onCustomerChat: isCustomerChannel(row.chat?.channelType),
    approval: {
      agentCreatedByUserId: row.agent?.createdByUserId ?? null,
      sessionUserId: row.chat?.userId ?? null,
    },
  }));
}

/**
 * A Schedule whose latest run failed. A later run (or a retry) that does not
 * fail takes the item out, so old failures do not pile up.
 */
export async function loadFailedScheduleRuns(
  companyId: string,
): Promise<NeedsYouCandidate[]> {
  const jobs = await db.query.cronJobs.findMany({
    where: eq(cronJobs.companyId, companyId),
    columns: { id: true, name: true, agentId: true },
    with: {
      agent: { columns: { id: true, name: true, kind: true } },
      runs: {
        columns: { id: true, status: true, error: true, createdAt: true, finishedAt: true },
        orderBy: (runs, { desc }) => [desc(runs.createdAt)],
        limit: 1,
      },
    },
  });
  const items: NeedsYouCandidate[] = [];
  for (const job of jobs) {
    const run = job.runs[0];
    if (!run || run.status !== "failed") continue;
    items.push({
      type: "failed_run",
      id: run.id,
      agentId: job.agentId,
      agentName: job.agent?.name ?? "",
      title: `${job.name} failed`,
      createdAt: run.finishedAt ?? run.createdAt,
      chatId: null,
      cronRunId: run.id,
      cronJobId: job.id,
      error: run.error,
      agentKind: job.agent?.kind ?? null,
    });
  }
  return items;
}

const QUESTION_TITLE_MAX = 80;

function questionTitle(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  return oneLine.length > QUESTION_TITLE_MAX
    ? `${oneLine.slice(0, QUESTION_TITLE_MAX - 1)}…`
    : oneLine;
}

/**
 * Open agent questions (checkpoints spec decisions 8-12). Never expire, so an
 * open question stays here until someone who can steer answers it.
 */
export async function loadOpenAgentQuestions(
  companyId: string,
): Promise<NeedsYouCandidate[]> {
  const rows = await db.query.agentQuestions.findMany({
    where: and(
      eq(agentQuestions.companyId, companyId),
      eq(agentQuestions.status, "open"),
    ),
    with: {
      agent: { columns: { id: true, name: true, kind: true } },
      cronRun: { columns: { id: true, jobId: true } },
    },
  });
  return rows.map((row) => ({
    type: "agent_question" as const,
    id: row.id,
    agentId: row.agentId,
    agentName: row.agent?.name ?? "",
    title: questionTitle(row.question),
    createdAt: row.createdAt,
    chatId: row.chatId,
    cronRunId: row.cronRunId,
    cronJobId: row.cronRun?.jobId ?? null,
    onCustomerChat: row.agent?.kind != null && row.agent.kind !== "operator",
    agentKind: row.agent?.kind ?? null,
  }));
}

const QUALIFIED_LEAD_LIMIT = 50;

/**
 * Qualified inbound leads waiting on the owner. The item leaves the list as
 * soon as the lead moves on (meeting, delivered, rejected, or any other
 * status). `createdAt` is the first `qualified` event, not `updated_at`,
 * which moves on every edit and would re-push an old lead.
 */
export async function loadQualifiedLeads(
  companyId: string,
): Promise<NeedsYouCandidate[]> {
  const found = await db.query.companyRecords.findMany({
    where: and(
      eq(companyRecords.companyId, companyId),
      eq(companyRecords.status, "qualified"),
      ne(companyRecords.source, "outbound"),
    ),
    orderBy: (records, { desc }) => [desc(records.createdAt)],
    limit: QUALIFIED_LEAD_LIMIT,
    with: {
      sourceAgent: { columns: { id: true, name: true, kind: true } },
    },
  });
  const rows = (Array.isArray(found) ? found : [])
    .filter((row) => row.status === "qualified" && row.source && row.source !== "outbound")
    .slice(0, QUALIFIED_LEAD_LIMIT);
  if (rows.length === 0) return [];

  const firstQualifiedAt = new Map<string, Date>();
  const events = await db.query.leadEvents.findMany({
    where: and(
      eq(leadEvents.companyId, companyId),
      eq(leadEvents.toStatus, "qualified"),
      inArray(leadEvents.recordId, rows.map((row) => row.id)),
    ),
    orderBy: (eventsTable, { asc }) => [asc(eventsTable.at)],
  });
  for (const event of Array.isArray(events) ? events : []) {
    if (event.toStatus !== "qualified" || firstQualifiedAt.has(event.recordId)) continue;
    firstQualifiedAt.set(event.recordId, new Date(event.at));
  }

  return rows.map((row) => ({
    type: "qualified_lead" as const,
    id: `lead:${row.id}`,
    agentId: row.sourceAgentId ?? "",
    agentName: row.sourceAgent?.name ?? row.name,
    title: "Yeni nitelikli başvuru",
    createdAt: firstQualifiedAt.get(row.id) ?? row.createdAt,
    chatId: row.chatId,
    cronRunId: null,
    cronJobId: null,
    agentKind: row.sourceAgent?.kind ?? null,
  }));
}

/**
 * The company's latest Daily brief while nobody has opened it on Home. One
 * brief per local day, so this is at most one item; a brief whose agent was
 * deleted is not listed.
 */
export async function loadUnreadBrief(
  companyId: string,
  now: Date = new Date(),
): Promise<NeedsYouCandidate[]> {
  const brief = await db.query.dailyBriefs.findFirst({
    columns: { id: true, agentId: true, cronRunId: true, localDate: true, readAt: true, createdAt: true },
    where: eq(dailyBriefs.companyId, companyId),
    orderBy: (briefs, { desc }) => [desc(briefs.localDate)],
    with: {
      agent: { columns: { id: true, name: true, kind: true } },
      cronRun: { columns: { id: true, jobId: true } },
      company: { columns: { timezone: true } },
    },
  });
  if (!brief || brief.readAt || !brief.agentId) return [];
  // Today's brief only: Home shows and marks read only today's, so an older
  // unread brief could never leave the list.
  if (!brief.company || brief.localDate !== localDateLabel(now, brief.company.timezone)) {
    return [];
  }
  return [
    {
      type: "brief",
      id: brief.id,
      agentId: brief.agentId,
      agentName: brief.agent?.name ?? "",
      title: "Today's brief",
      createdAt: brief.createdAt,
      chatId: null,
      cronRunId: brief.cronRunId,
      cronJobId: brief.cronRun?.jobId ?? null,
      agentKind: brief.agent?.kind ?? null,
    },
  ];
}

/**
 * Agents in a lead workflow (a workflow whose target metric counts leads).
 * Their failed runs are tier 1 and their questions tier 2.
 */
export async function loadLeadWorkflowAgentIds(
  companyId: string,
): Promise<Set<string>> {
  return listLeadWorkflowAgentIds(companyId);
}

type CheckpointCandidate = Extract<NeedsYouCandidate, { type: "checkpoint" }>;

export type NeedsYouViewerFilter = {
  canApproveCheckpoint: (item: CheckpointCandidate) => boolean;
  canSeeOperatorItem: (item: OperatorItemCandidate) => boolean;
};

/**
 * The viewer filter, from one membership read.
 *
 * Checkpoints: S99's one approve rule (`canApproveCheckpoint`, spec
 * 2026-10-02-approve-rights): the owner, the agent creator, or a member with
 * the `operator` page permission and `canApprove` on that agent.
 *
 * Questions, failed runs and briefs (W5GAP): the owner, or a `role = member` with the
 * `operator` page permission on an operator agent of this company (the rule
 * of `requireOperatorAgentAccess`; the loaders already scope to the company).
 *
 * Client users and non-members see nothing.
 */
export async function loadNeedsYouViewerFilter(args: {
  companyId: string;
  viewerId: string;
  ownerId: string;
}): Promise<NeedsYouViewerFilter> {
  if (args.viewerId === args.ownerId) {
    return { canApproveCheckpoint: () => true, canSeeOperatorItem: () => true };
  }
  const [membership, agentUserRows] = await Promise.all([
    db.query.companyMembers.findFirst({
      where: and(
        eq(companyMembers.companyId, args.companyId),
        eq(companyMembers.userId, args.viewerId),
      ),
    }),
    db.query.operatorAgentEditors.findMany({
      columns: { agentId: true, canApprove: true },
      where: eq(operatorAgentEditors.userId, args.viewerId),
    }),
  ]);
  const agentUsers = new Map(agentUserRows.map((r) => [r.agentId, r]));
  const company = { ownerId: args.ownerId };
  const permissions = membership?.pagePermissions as
    | { operator?: unknown }
    | null
    | undefined;
  const operatorMember =
    membership != null &&
    membership.role !== "client" &&
    permissions?.operator === true;
  return {
    canApproveCheckpoint: (item) =>
      canApproveCheckpoint({
        userId: args.viewerId,
        company,
        agent: { createdByUserId: item.approval.agentCreatedByUserId },
        membership,
        agentUser: agentUsers.get(item.agentId),
      }),
    canSeeOperatorItem: (item) =>
      operatorMember && item.agentKind === "operator",
  };
}

/** Checkpoint half of `loadNeedsYouViewerFilter`. */
export async function loadCheckpointApprovePredicate(args: {
  companyId: string;
  viewerId: string;
  ownerId: string;
}): Promise<(item: CheckpointCandidate) => boolean> {
  return (await loadNeedsYouViewerFilter(args)).canApproveCheckpoint;
}

/** The full, ordered, viewer-filtered Needs you list for one company. */
export async function getNeedsYou(args: {
  companyId: string;
  viewerId: string;
  ownerId: string;
}): Promise<NeedsYouList> {
  const [checkpointItems, runItems, questionItems, briefItems, leadItems, workflows, viewer] =
    await Promise.all([
      loadOpenCheckpoints(args.companyId),
      loadFailedScheduleRuns(args.companyId),
      loadOpenAgentQuestions(args.companyId),
      loadUnreadBrief(args.companyId),
      loadQualifiedLeads(args.companyId),
      listAgentWorkflows(args.companyId),
      loadNeedsYouViewerFilter({
        companyId: args.companyId,
        viewerId: args.viewerId,
        ownerId: args.ownerId,
      }),
    ]);
  return buildNeedsYou({
    candidates: [...checkpointItems, ...runItems, ...questionItems, ...briefItems, ...leadItems],
    isLeadWorkflowAgent: (agentId) => workflows.leadAgentIds.has(agentId),
    canApproveCheckpoint: viewer.canApproveCheckpoint,
    canSeeOperatorItem: viewer.canSeeOperatorItem,
    workflowOf: (agentId) => workflows.workflowNameByAgent.get(agentId) ?? null,
  });
}
