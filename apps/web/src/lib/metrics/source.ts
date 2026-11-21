import { db } from "@/db";
import {
  agents,
  channels,
  chats,
  companies,
  companyMembers,
  companyRecords,
  handoffRequests,
  leadEvents,
  tokenUsage,
} from "@/db/schema";
import type { CompanyRecordStatus } from "@relay/db";
import { and, eq, gte, inArray, lt, ne, or } from "drizzle-orm";
import { isoWeekId, isoWeekRange } from "@/lib/time";
import type { MetricKey, MetricSource } from "@/lib/workflows/metrics";
import {
  costPerQualifiedLead,
  countLeadMetrics,
  leadQualityScore,
  leadsPerAgent,
  LEAD_STATUS_BUCKETS,
  type CostPerQualifiedLead,
  type LeadEventFact,
  type WeekRange,
} from "./compute";

// Database side of the metric-key catalog, goals and KPIs (S23). Every number
// is week-to-date for the ISO week (Monday 00:00) containing `now` in the
// company's timezone.

export type CompanyWeek = {
  range: WeekRange;
  timeZone: string;
  /** e.g. `2026-W41`. */
  weekId: string;
  /** Local Monday as `YYYY-MM-DD`; matches `token_usage.week_start`. */
  weekStartDate: string;
};

function safeWeek(now: Date, timeZone: string): CompanyWeek {
  try {
    return weekFor(now, timeZone);
  } catch {
    // A bad stored zone must not break Home; fall back to UTC weeks.
    return weekFor(now, "UTC");
  }
}

function weekFor(now: Date, timeZone: string): CompanyWeek {
  const range = isoWeekRange(now, timeZone);
  const weekStartDate = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(range.from);
  return { range, timeZone, weekId: isoWeekId(now, timeZone), weekStartDate };
}

/** The company's current week, or null when the company does not exist. */
export async function loadCompanyWeek(
  companyId: string,
  now: Date,
): Promise<(CompanyWeek & { ownerId: string }) | null> {
  const company = await db.query.companies.findFirst({
    columns: { id: true, timezone: true, ownerId: true },
    where: eq(companies.id, companyId),
  });
  if (!company) return null;
  return { ...safeWeek(now, company.timezone), ownerId: company.ownerId };
}

/**
 * Events in the week, plus every earlier `delivered` event so a lead counts
 * only on its first delivery.
 */
export async function loadLeadFacts(
  companyId: string,
  range: WeekRange,
): Promise<LeadEventFact[]> {
  const delivered = LEAD_STATUS_BUCKETS.delivered as readonly string[];
  return db.query.leadEvents.findMany({
    columns: {
      recordId: true,
      fromStatus: true,
      toStatus: true,
      agentId: true,
      userId: true,
      at: true,
    },
    where: and(
      eq(leadEvents.companyId, companyId),
      lt(leadEvents.at, range.to),
      or(
        gte(leadEvents.at, range.from),
        inArray(leadEvents.toStatus, delivered as CompanyRecordStatus[]),
      ),
    ),
  });
}

async function loadCompanyAgents(
  companyId: string,
): Promise<{ id: string; kind: "customer" | "operator" }[]> {
  return db.query.agents.findMany({
    columns: { id: true, kind: true },
    where: eq(agents.companyId, companyId),
  });
}

function customerIds(rows: readonly { id: string; kind: string }[]): Set<string> {
  return new Set(rows.filter((a) => a.kind === "customer").map((a) => a.id));
}

async function loadScores(
  companyId: string,
  recordIds: readonly string[],
): Promise<Map<string, number | null>> {
  if (recordIds.length === 0) return new Map();
  const rows = await db.query.companyRecords.findMany({
    columns: { id: true, score: true },
    where: and(
      eq(companyRecords.companyId, companyId),
      inArray(companyRecords.id, [...recordIds]),
    ),
  });
  return new Map(rows.map((r) => [r.id, r.score]));
}

/** Customer-facing channels: a conversation with a customer, not a session. */
export const CONVERSATION_CHANNEL_TYPES = [
  "whatsapp",
  "instagram",
  "telegram",
  "messenger",
  "widget",
] as const;

async function loadChatsInWeek(
  companyId: string,
  range: WeekRange,
): Promise<{ agentId: string | null; channelType: string | null }[]> {
  return db.query.chats.findMany({
    columns: { agentId: true, channelType: true },
    where: and(
      eq(chats.companyId, companyId),
      gte(chats.createdAt, range.from),
      lt(chats.createdAt, range.to),
    ),
  });
}

function countConversations(
  rows: readonly { channelType: string | null }[],
): number {
  const types: readonly string[] = CONVERSATION_CHANNEL_TYPES;
  return rows.filter((c) => c.channelType !== null && types.includes(c.channelType))
    .length;
}

async function countStaffAnswers(
  companyId: string,
  range: WeekRange,
): Promise<number> {
  const rows = await db.query.handoffRequests.findMany({
    columns: { id: true },
    where: and(
      eq(handoffRequests.companyId, companyId),
      gte(handoffRequests.answeredAt, range.from),
      lt(handoffRequests.answeredAt, range.to),
    ),
  });
  return rows.length;
}

const LEAD_KEYS: ReadonlySet<MetricKey> = new Set<MetricKey>([
  "records.gathered",
  "records.qualified",
  "records.contacted_replied",
  "records.delivered",
  "leads.qualified_delivered",
  "leads.inbound",
  "leads.quality_score",
]);

/**
 * The real `MetricSource`. Keys without a data source yet
 * (`posts.scheduled_review`, `reviews.new_negative`, `report.next_run`) are
 * left out, as is a quality score with nothing scored delivered.
 */
export const dbMetricSource: MetricSource = {
  async getValues(companyId, keys, now) {
    const want = new Set(keys);
    const out: Partial<Record<MetricKey, number>> = {};
    if (want.size === 0) return out;
    const week = await loadCompanyWeek(companyId, now);
    if (!week) return out;
    const { range } = week;

    const tasks: Promise<void>[] = [];

    if ([...want].some((k) => LEAD_KEYS.has(k))) {
      tasks.push(
        (async () => {
          const [events, agentRows] = await Promise.all([
            loadLeadFacts(companyId, range),
            loadCompanyAgents(companyId),
          ]);
          const counts = countLeadMetrics(events, range, customerIds(agentRows));
          const values: Partial<Record<MetricKey, number>> = {
            "records.gathered": counts.gathered,
            "records.qualified": counts.qualified,
            "records.contacted_replied": counts.contactedReplied,
            "records.delivered": counts.delivered,
            "leads.qualified_delivered": counts.delivered,
            "leads.inbound": counts.inbound,
          };
          if (want.has("leads.quality_score")) {
            const scores = await loadScores(companyId, counts.deliveredRecordIds);
            const quality = leadQualityScore(counts.deliveredRecordIds, scores);
            if (quality !== null) values["leads.quality_score"] = quality;
          }
          for (const [k, v] of Object.entries(values) as [MetricKey, number][]) {
            if (want.has(k)) out[k] = v;
          }
        })(),
      );
    }

    if (want.has("conversations.started")) {
      tasks.push(
        loadChatsInWeek(companyId, range).then((rows) => {
          out["conversations.started"] = countConversations(rows);
        }),
      );
    }

    if (want.has("handoff.staff_answers")) {
      tasks.push(
        countStaffAnswers(companyId, range).then((n) => {
          out["handoff.staff_answers"] = n;
        }),
      );
    }

    await Promise.all(tasks);
    return out;
  },
};

// ---------------------------------------------------------------------------
// Company KPIs
// ---------------------------------------------------------------------------

/**
 * Tokens the company spent in the week: its customer channels plus the owner
 * and members (operator sessions and Schedules record under the user).
 * `token_usage` is bucketed by UTC Monday, so the company week reads the
 * bucket dated its own local Monday. A person in several companies is
 * counted in each.
 */
export async function loadCompanyTokens(
  companyId: string,
  ownerId: string,
  weekStartDate: string,
  agentIds: readonly string[],
): Promise<number> {
  const [channelRows, memberRows] = await Promise.all([
    agentIds.length === 0
      ? Promise.resolve([] as { id: string }[])
      : db.query.channels.findMany({
          columns: { id: true },
          where: inArray(channels.agentId, [...agentIds]),
        }),
    db.query.companyMembers.findMany({
      columns: { userId: true },
      where: and(
        eq(companyMembers.companyId, companyId),
        ne(companyMembers.role, "client"),
      ),
    }),
  ]);
  const channelIds = channelRows.map((c) => c.id);
  const userIds = [...new Set([ownerId, ...memberRows.map((m) => m.userId)])];
  const owners = [
    and(eq(tokenUsage.identifierType, "user"), inArray(tokenUsage.identifier, userIds)),
  ];
  if (channelIds.length > 0) {
    owners.push(
      and(
        eq(tokenUsage.identifierType, "channel"),
        inArray(tokenUsage.identifier, channelIds),
      ),
    );
  }
  const rows = await db.query.tokenUsage.findMany({
    columns: { tokensUsed: true },
    where: and(eq(tokenUsage.weekStart, weekStartDate), or(...owners)),
  });
  return rows.reduce((sum, r) => sum + r.tokensUsed, 0);
}

export type CompanyKpis = {
  weekId: string;
  range: WeekRange;
  timeZone: string;
  /** Qualified leads first delivered this week (the weekly target count). */
  qualifiedDelivered: number;
  inbound: number;
  /** Average fit score of this week's delivered leads; null if none scored. */
  qualityScore: number | null;
  /** Null when nothing was delivered. */
  costPerQualifiedLead: CostPerQualifiedLead | null;
};

export async function getCompanyKpis(
  companyId: string,
  now: Date = new Date(),
): Promise<CompanyKpis | null> {
  const week = await loadCompanyWeek(companyId, now);
  if (!week) return null;
  const [events, agentRows] = await Promise.all([
    loadLeadFacts(companyId, week.range),
    loadCompanyAgents(companyId),
  ]);
  const counts = countLeadMetrics(events, week.range, customerIds(agentRows));
  const [scores, tokens] = await Promise.all([
    loadScores(companyId, counts.deliveredRecordIds),
    loadCompanyTokens(
      companyId,
      week.ownerId,
      week.weekStartDate,
      agentRows.map((a) => a.id),
    ),
  ]);
  return {
    weekId: week.weekId,
    range: week.range,
    timeZone: week.timeZone,
    qualifiedDelivered: counts.delivered,
    inbound: counts.inbound,
    qualityScore: leadQualityScore(counts.deliveredRecordIds, scores),
    costPerQualifiedLead: costPerQualifiedLead(tokens, counts.delivered),
  };
}

// ---------------------------------------------------------------------------
// Canvas stats
// ---------------------------------------------------------------------------

export type AgentWeekStats = { chats: number; leads: number };

export type CanvasStats = {
  weekId: string;
  /** Per agent id; agents with no activity this week are absent. */
  agents: Record<string, AgentWeekStats>;
};

/** Chats started and leads moved (from `lead_events`) per agent this week. */
export async function getCanvasStats(
  companyId: string,
  now: Date = new Date(),
): Promise<CanvasStats | null> {
  const week = await loadCompanyWeek(companyId, now);
  if (!week) return null;
  const [chatRows, events] = await Promise.all([
    loadChatsInWeek(companyId, week.range),
    loadLeadFacts(companyId, week.range),
  ]);
  const stats: Record<string, AgentWeekStats> = {};
  const entry = (id: string) => (stats[id] ??= { chats: 0, leads: 0 });
  for (const c of chatRows) {
    if (c.agentId && c.channelType !== "master") entry(c.agentId).chats += 1;
  }
  for (const [agentId, n] of leadsPerAgent(events, week.range)) {
    entry(agentId).leads = n;
  }
  return { weekId: week.weekId, agents: stats };
}
