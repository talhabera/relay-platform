import { and, asc, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";

import { db } from "@/db";
import { agents, chats, companyRecords, workflows } from "@/db/schema";
import { listQualifiedLeads } from "@/lib/leads";
import { toSessionLead } from "@/lib/leads/session-leads";
import {
  CONVERSATION_CHANNEL_TYPES,
  countLeadMetrics,
  getCampaignMetrics,
  loadCompanyTokens,
  loadCompanyWeek,
  loadLeadFacts,
  type WeekRange,
} from "@/lib/metrics";
import { inRange, type LeadEventFact } from "@/lib/metrics/compute";
import { shiftIsoWeek } from "@/lib/time";

import { buildLeadQuality, type LeadQualityModel } from "./lead-quality-model";
import {
  adCampaignRows,
  buildOverview,
  isEmptyWeek,
  TREND_WEEKS,
  weekChoiceLabel,
  type OverviewModel,
  type QualifiedFact,
  type WeekChoice,
} from "./overview-model";

/** The metric key whose weekly target is the qualified-lead goal. */
const LEAD_TARGET_METRIC = "leads.qualified_delivered";

export type OverviewData = WeekMeta & { model: OverviewModel };
export type LeadQualityData = WeekMeta & { model: LeadQualityModel };

function safeWeeks(now: Date, timeZone: string, offset: number): { weeks: WeekRange[]; timeZone: string } {
  const build = (tz: string) =>
    Array.from({ length: TREND_WEEKS }, (_, i) => shiftIsoWeek(now, tz, offset - (TREND_WEEKS - 1 - i)));
  try {
    return { weeks: build(timeZone), timeZone };
  } catch {
    // A bad stored zone must not break Analytics; fall back to UTC weeks.
    return { weeks: build("UTC"), timeZone: "UTC" };
  }
}

/** Local Monday as `YYYY-MM-DD`, the `token_usage.week_start` bucket. */
export function weekStartDate(range: WeekRange, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(range.from);
}

async function loadScores(companyId: string, ids: readonly string[]): Promise<Map<string, number | null>> {
  if (ids.length === 0) return new Map();
  const rows = await db.query.companyRecords.findMany({
    columns: { id: true, score: true },
    where: and(eq(companyRecords.companyId, companyId), inArray(companyRecords.id, [...ids])),
  });
  return new Map(rows.map((r) => [r.id, r.score]));
}

async function countConversations(companyId: string, range: WeekRange): Promise<number> {
  const rows = await db.query.chats.findMany({
    columns: { id: true },
    where: and(
      eq(chats.companyId, companyId),
      inArray(chats.channelType, [...CONVERSATION_CHANNEL_TYPES]),
      gte(chats.createdAt, range.from),
      lt(chats.createdAt, range.to),
    ),
  });
  return rows.length;
}

async function loadLeadTarget(companyId: string): Promise<number | null> {
  const row = await db.query.workflows.findFirst({
    columns: { weeklyTarget: true },
    where: and(
      eq(workflows.companyId, companyId),
      eq(workflows.targetMetricKey, LEAD_TARGET_METRIC),
      isNotNull(workflows.weeklyTarget),
    ),
    orderBy: [asc(workflows.position)],
  });
  return row?.weeklyTarget ?? null;
}

/** Rows every week-based view reads: the selected week, the one before, and the trend weeks. */
type WeekBase = {
  timeZone: string;
  weeks: WeekRange[];
  events: LeadEventFact[];
  customerAgentIds: Set<string>;
  qualified: QualifiedFact[];
  conversations: number;
  target: number | null;
  scores: Map<string, number | null>;
  tokens: { current: number; previous: number };
  weekOptions: { value: WeekChoice; label: string }[];
};

async function loadWeekBase(companyId: string, choice: WeekChoice, now: Date): Promise<WeekBase | null> {
  const company = await loadCompanyWeek(companyId, now);
  if (!company) return null;
  const { weeks, timeZone } = safeWeeks(now, company.timeZone, choice === "last" ? -1 : 0);
  const week = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];

  const [events, agentRows, qualified, conversations, target] = await Promise.all([
    loadLeadFacts(companyId, { from: weeks[0].from, to: week.to }),
    db.query.agents.findMany({ columns: { id: true, kind: true }, where: eq(agents.companyId, companyId) }),
    listQualifiedLeads(companyId, week),
    countConversations(companyId, week),
    loadLeadTarget(companyId),
  ]);
  const customerAgentIds = new Set(agentRows.filter((a) => a.kind === "customer").map((a) => a.id));
  const agentIds = agentRows.map((a) => a.id);
  const delivered = [
    ...countLeadMetrics(events, week, customerAgentIds).deliveredRecordIds,
    ...countLeadMetrics(events, prev, customerAgentIds).deliveredRecordIds,
  ];
  const [scores, current, previous] = await Promise.all([
    loadScores(companyId, delivered),
    loadCompanyTokens(companyId, company.ownerId, weekStartDate(week, timeZone), agentIds),
    loadCompanyTokens(companyId, company.ownerId, weekStartDate(prev, timeZone), agentIds),
  ]);

  const thisWeek = shiftIsoWeek(now, timeZone, 0);
  const lastWeek = shiftIsoWeek(now, timeZone, -1);
  return {
    timeZone,
    weeks,
    events,
    customerAgentIds,
    qualified: qualified.map((q) => ({ id: q.id, source: q.source })),
    conversations,
    target,
    scores,
    tokens: { current, previous },
    weekOptions: [
      { value: "this", label: weekChoiceLabel("this", thisWeek, timeZone) },
      { value: "last", label: weekChoiceLabel("last", lastWeek, timeZone) },
    ],
  };
}

/** What both views hand the page besides their model. */
type WeekMeta = {
  weekOptions: { value: WeekChoice; label: string }[];
  /** The selected week and its zone, for the empty-range copy and the export file name. */
  week: WeekRange;
  timeZone: string;
  /** Nothing happened in the week: render the empty-range state. */
  empty: boolean;
};

function weekMeta(base: WeekBase): WeekMeta {
  return {
    weekOptions: base.weekOptions,
    week: base.weeks[base.weeks.length - 1],
    timeZone: base.timeZone,
    empty: isEmptyWeek(base),
  };
}

/** Overview data for the selected week; null when the company does not exist. */
export async function loadOverview(
  companyId: string,
  choice: WeekChoice,
  now: Date = new Date(),
): Promise<OverviewData | null> {
  const base = await loadWeekBase(companyId, choice, now);
  if (!base) return null;
  const campaigns = await getCampaignMetrics(companyId, base.weeks[base.weeks.length - 1]);
  const model = buildOverview({
    timeZone: base.timeZone,
    weeks: base.weeks,
    events: base.events,
    customerAgentIds: base.customerAgentIds,
    qualified: base.qualified,
    scores: base.scores,
    tokens: base.tokens,
    conversations: base.conversations,
    target: base.target,
    campaigns: adCampaignRows(campaigns),
  });
  return { model, ...weekMeta(base) };
}

/** Lead record columns the Lead quality list reads (as the session Leads pane). */
const leadColumns = {
  id: companyRecords.id,
  entityType: companyRecords.entityType,
  name: companyRecords.name,
  domain: companyRecords.domain,
  phone: companyRecords.phone,
  source: companyRecords.source,
  status: companyRecords.status,
  fitScore: companyRecords.score,
  reasons: companyRecords.fitReasons,
  rejectReason: companyRecords.rejectReason,
  payload: companyRecords.payload,
  createdAt: companyRecords.createdAt,
};

function idsReaching(events: readonly LeadEventFact[], week: WeekRange, status: string): string[] {
  const ids = new Set<string>();
  for (const e of events) if (e.toStatus === status && inRange(e.at, week)) ids.add(e.recordId);
  return [...ids];
}

/** Lead quality data for the selected week; null when the company does not exist. */
export async function loadLeadQuality(
  companyId: string,
  choice: WeekChoice,
  now: Date = new Date(),
): Promise<LeadQualityData | null> {
  const base = await loadWeekBase(companyId, choice, now);
  if (!base) return null;
  const week = base.weeks[base.weeks.length - 1];
  const listed = [...new Set([...base.qualified.map((q) => q.id), ...idsReaching(base.events, week, "borderline")])];
  const rejectedIds = idsReaching(base.events, week, "rejected");

  const [leadRows, rejectedRows] = await Promise.all([
    listed.length === 0
      ? []
      : db
          .select(leadColumns)
          .from(companyRecords)
          .where(and(eq(companyRecords.companyId, companyId), inArray(companyRecords.id, listed))),
    rejectedIds.length === 0
      ? []
      : db
          .select({ id: companyRecords.id, rejectReason: companyRecords.rejectReason })
          .from(companyRecords)
          .where(and(eq(companyRecords.companyId, companyId), inArray(companyRecords.id, rejectedIds))),
  ]);

  const model = buildLeadQuality({
    weeks: base.weeks,
    events: base.events,
    customerAgentIds: base.customerAgentIds,
    qualified: base.qualified,
    scores: base.scores,
    conversations: base.conversations,
    target: base.target,
    leads: leadRows.map(toSessionLead),
    rejectReasons: rejectedRows.map((r) => r.rejectReason),
  });
  return { model, ...weekMeta(base) };
}
