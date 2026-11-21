// Read interfaces the BE sessions implement and the fixtures layer stands in
// for until they land. Screens import these types and a reader, never a table.
// Specs: docs/superpowers/specs/2026-10-02-*.md (named per section below).

import type { InferSelectModel } from "drizzle-orm";
import type {
  handoffRequests,
  PagePermissionKey,
  PagePermissions,
} from "@relay/db/schema";
import type { NeedsYouList } from "@/lib/operator/needs-you";

// ---------------------------------------------------------------------------
// Metric keys (workflow spec decision 5; report snapshot spec decision 4).
// S23 implements each key as a weekly query; fixtures return stored values.
// ---------------------------------------------------------------------------

export const METRIC_KEYS = [
  "records.gathered",
  "records.qualified",
  "records.contacted_replied",
  "records.delivered",
  "leads.qualified_delivered",
  "leads.inbound",
  "leads.quality_score",
  "conversations.started",
  "handoff.staff_answers",
  "posts.scheduled_review",
  "reviews.new_negative",
  "report.next_run",
  "brief.last_run",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

// ---------------------------------------------------------------------------
// Workflows and target (workflow-stage-model, lead-attribution specs). S11/S23.
// ---------------------------------------------------------------------------

export type WorkflowFlow = "sequence" | "parallel";
export type StageState = "default" | "active" | "needs_you" | "idle";

export type AgentRef = { id: string; name: string };

export type WorkflowStageView = {
  id: string;
  order: number;
  name: string;
  /** Null for an outcome stage or a stage whose agent was deleted ("No agent"). */
  agent: AgentRef | null;
  metricKey: MetricKey;
  /** Null when the metric has no data source yet. */
  metricValue: number | null;
  /** Needs you items for the stage's agent. */
  pending: number;
  state: StageState;
};

export type WorkflowEdge = { fromStageId: string; toStageId: string };

export type InboundSummary = {
  stageId: string;
  /** Week-to-date inbound leads and conversations from customer agents. */
  leads: number;
  conversations: number;
  customerAgents: AgentRef[];
};

export type TargetProgress = {
  weeklyTarget: number;
  metricKey: MetricKey;
  value: number;
};

export type IntakeField = { key: string; label: string; required: boolean };

export type WorkflowView = {
  id: string;
  companyId: string;
  packageSlug: string;
  name: string;
  flow: WorkflowFlow;
  position: number;
  stages: WorkflowStageView[];
  /** Consecutive stages of a `sequence` workflow; empty for `parallel`. */
  edges: WorkflowEdge[];
  inbound: InboundSummary | null;
  target: TargetProgress | null;
  intake: IntakeField[];
};

export interface WorkflowsReader {
  listWorkflows(companyId: string): Promise<WorkflowView[]>;
}

// ---------------------------------------------------------------------------
// Needs you (needs-you-ordering, approve-rights specs). Real impl: S04.
// ---------------------------------------------------------------------------

export interface NeedsYouReader {
  /** Ordered list filtered to what the viewer can act on. */
  getNeedsYou(companyId: string, viewerUserId: string): Promise<NeedsYouList>;
}

// ---------------------------------------------------------------------------
// Human handoff (human-handoff spec). Inbox read model.
// ---------------------------------------------------------------------------

type HandoffRequestRow = InferSelectModel<typeof handoffRequests>;

export type HandoffRequestView = Pick<
  HandoffRequestRow,
  | "id"
  | "companyId"
  | "agentId"
  | "chatId"
  | "status"
  | "mode"
  | "reason"
  | "confidence"
  | "questions"
  | "suggestedReplies"
  | "recipientName"
  | "expiresAt"
  | "answer"
  | "replyMode"
  | "answeredAt"
  | "takenOverAt"
  | "handedBackAt"
  | "expiredAt"
  | "createdAt"
> & {
  agentName: string;
  customerName: string;
  channel: LeadSource;
};

export interface HandoffReader {
  listHandoffRequests(
    companyId: string,
    filter?: { status?: HandoffRequestRow["status"][] },
  ): Promise<HandoffRequestView[]>;
}

// ---------------------------------------------------------------------------
// Client role and approvers (client-role-and-portal, approve-rights). S12/S99.
// ---------------------------------------------------------------------------

export type MembershipRole = "member" | "client";
/** What `requireClientAccess` returns: who the viewer is to the company. */
export type CompanyAccessRole = "owner" | MembershipRole;

export type AgentUserView = {
  userId: string;
  name: string;
  email: string;
  isCreator: boolean;
  canEdit: boolean;
  canApprove: boolean;
};

export interface AccessReader {
  /** Null when the user has no access to the company. */
  getAccessRole(
    companyId: string,
    userId: string,
  ): Promise<CompanyAccessRole | null>;
  listAgentUsers(agentId: string): Promise<AgentUserView[]>;
  /** Owner, agent creator, and agent users with approve on a member row. */
  listApprovers(agentId: string): Promise<AgentRef[]>;
}

// ---------------------------------------------------------------------------
// Leads and lead events (lead-scoring, lead-attribution specs). S26/S100.
// ---------------------------------------------------------------------------

export type LeadSource = "outbound" | "whatsapp" | "instagram" | "widget" | "shopify";
export type LeadBand = "qualified" | "borderline" | "rejected";
export type LeadStatus =
  | "gathered"
  | "qualified"
  | "borderline"
  | "rejected"
  | "contacted"
  | "interested"
  | "delivered";

export const FIT_SCORE_QUALIFIED = 70;
export const FIT_SCORE_BORDERLINE = 50;

export type LeadView = {
  id: string;
  companyId: string;
  name: string;
  company: string | null;
  domain: string | null;
  phone: string | null;
  source: LeadSource;
  /** 0-100; null until scored. */
  fitScore: number | null;
  band: LeadBand | null;
  status: LeadStatus;
  /** 1-3 short fit reasons. */
  reasons: string[];
  /** Exactly one when band is `rejected`. */
  rejectReason: string | null;
  intake: Record<string, string>;
  intakeComplete: boolean;
  chatId: string | null;
  firstDeliveredAt: Date | null;
  createdAt: Date;
};

export type LeadEvent = {
  id: string;
  companyId: string;
  recordId: string;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus;
  /** Exactly one of agentId / userId is set. */
  agentId: string | null;
  userId: string | null;
  at: Date;
};

export interface LeadsReader {
  listLeads(
    companyId: string,
    filter?: { band?: LeadBand; source?: LeadSource },
  ): Promise<LeadView[]>;
  /** Events with `from <= at < to`, oldest first. */
  listLeadEvents(
    companyId: string,
    range: { from: Date; to: Date },
  ): Promise<LeadEvent[]>;
}

// ---------------------------------------------------------------------------
// Report snapshots and Live feed (report-snapshots-and-live-feed). S86/S90/S101.
// ---------------------------------------------------------------------------

export type ReportPeriod = "daily" | "weekly" | "monthly";

export type ReportMetric = {
  metricKey: MetricKey;
  value: number;
  previous: number | null;
};

export type ReportSeriesPoint = { label: string; value: number };
export type FunnelStep = {
  stage: "gathered" | "qualified" | "contacted" | "delivered";
  value: number;
};

export type ReportSnapshot = {
  id: string;
  companyId: string;
  period: ReportPeriod;
  start: Date;
  end: Date;
  metrics: ReportMetric[];
  series: { delivered: ReportSeriesPoint[]; funnel: FunnelStep[] };
  /** Written by Insights; null without it. */
  narrative: { summary: string; highlights: string[] } | null;
  frozenAt: Date;
};

export interface ReportsReader {
  /** Closed periods only, newest first. */
  listReportSnapshots(
    companyId: string,
    period: ReportPeriod,
  ): Promise<ReportSnapshot[]>;
  getReportSnapshot(
    companyId: string,
    id: string,
  ): Promise<ReportSnapshot | null>;
}

export const PORTAL_EVENT_TYPES = [
  "lead_inbound_qualified",
  "lead_delivered",
  "handoff_sent",
  "conversation_started",
  "site_visit_booked",
  "review_new",
] as const;
export type PortalEventType = (typeof PORTAL_EVENT_TYPES)[number];

export type PortalEvent = {
  id: string;
  companyId: string;
  type: PortalEventType;
  at: Date;
  title: string;
  detail: string;
  channel: LeadSource | null;
  refId: string | null;
};

export interface PortalEventsReader {
  /** Newest first. */
  listPortalEvents(
    companyId: string,
    opts?: { since?: Date; limit?: number },
  ): Promise<PortalEvent[]>;
}

// ---------------------------------------------------------------------------
// Home tiles (panel-chat-removal-and-home spec decision 4). S37/S106.
// ---------------------------------------------------------------------------

export const HOME_TILE_KEYS = [
  "goal_strip",
  "needs_you",
  "today",
  "lead_engine",
  "agent_map",
  "daily_brief",
  "my_tasks",
  "ad_report",
] as const;
export type HomeTileKey = (typeof HOME_TILE_KEYS)[number];

export type HomeTileVisibility =
  | { kind: "everyone" }
  | { kind: "requires"; permission: PagePermissionKey }
  | { kind: "owners_only" };

export type HomeTileConfig = {
  key: HomeTileKey;
  visible: boolean;
  order: number;
  visibility: HomeTileVisibility;
};

export type HomeViewer = { isOwner: boolean; pagePermissions: PagePermissions };

export interface HomeTilesReader {
  /** The owner's configuration, in order. */
  getHomeTiles(companyId: string): Promise<HomeTileConfig[]>;
  /** Tiles this viewer sees, in order. */
  getVisibleHomeTiles(
    companyId: string,
    viewer: HomeViewer,
  ): Promise<HomeTileKey[]>;
}

// ---------------------------------------------------------------------------

export interface RelayReaders {
  workflows: WorkflowsReader;
  needsYou: NeedsYouReader;
  handoff: HandoffReader;
  access: AccessReader;
  leads: LeadsReader;
  reports: ReportsReader;
  portalEvents: PortalEventsReader;
  homeTiles: HomeTilesReader;
}
