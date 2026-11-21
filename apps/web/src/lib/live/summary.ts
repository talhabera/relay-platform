import { and, asc, count, eq, gte, inArray, isNotNull, lt, min } from "drizzle-orm";
import { db } from "@/db";
import { chats, companies, handoffRequests, portalEvents, workflows } from "@/db/schema";
import {
  CONVERSATION_CHANNEL_TYPES,
  dbMetricSource,
  getCompanyKpis,
  type CompanyKpis,
  type CostPerQualifiedLead,
} from "@/lib/metrics";
import { localDayRange } from "@/lib/time";
import { isMetricKey } from "@/lib/workflows/metrics";
import type { MetricKey } from "@/lib/fixtures/interfaces";
import { countBySource, hourlySeries, type HourlySeries, type SourceCount } from "./hourly";

// Live page numbers (S90, spec 2026-10-02-report-snapshots-and-live-feed
// decision 3, Figma 11b). Reports hold closed periods; Live holds the current
// one: week-to-date KPIs for the ISO week and today's strip, both in company
// time. Cards whose source does not exist yet (site visits, median first
// reply, resolved without staff) are left out rather than sent as zero.

export type LiveRange = { from: Date; to: Date };

export type LiveTarget = { metricKey: MetricKey; weeklyTarget: number; value: number };

export type LiveWeek = {
  weekId: string;
  range: LiveRange;
  qualifiedDelivered: number;
  inbound: number;
  /** Null when no delivered lead is scored. */
  qualityScore: number | null;
  /** Null when nothing was delivered. */
  costPerQualifiedLead: CostPerQualifiedLead | null;
  /** The first workflow (by position) with a weekly target; null without one. */
  target: LiveTarget | null;
};

export type LiveToday = {
  range: LiveRange;
  /** Customer-agent conversations started since local 00:00. */
  conversations: number;
  /** `lead_inbound_qualified` feed rows since local 00:00. */
  inboundQualified: number;
  /** Open handoff requests now; `oldestAt` is the longest-waiting one. */
  waitingForStaff: { count: number; oldestAt: Date | null };
  hourly: HourlySeries;
  sources: SourceCount[];
};

export type LiveSummary = {
  companyId: string;
  timeZone: string;
  generatedAt: Date;
  week: LiveWeek;
  today: LiveToday;
};

/** What `buildLiveSummary` reads; the DB implementation is `dbLiveSources`. */
export interface LiveSources {
  timeZone(companyId: string): Promise<string | null>;
  kpis(companyId: string, now: Date): Promise<CompanyKpis | null>;
  weeklyTarget(
    companyId: string,
  ): Promise<{ metricKey: MetricKey; weeklyTarget: number } | null>;
  metricValue(companyId: string, key: MetricKey, now: Date): Promise<number | null>;
  conversationsStarted(
    companyId: string,
    range: LiveRange,
  ): Promise<{ at: Date; channel: string }[]>;
  countFeedEvents(companyId: string, type: "lead_inbound_qualified", range: LiveRange): Promise<number>;
  openHandoffs(companyId: string): Promise<{ count: number; oldestAt: Date | null }>;
}

function safeDayRange(now: Date, timeZone: string): { range: LiveRange; timeZone: string } {
  try {
    return { range: localDayRange(now, timeZone), timeZone };
  } catch {
    // Same fallback as the metrics layer: a bad stored zone must not break Live.
    return { range: localDayRange(now, "UTC"), timeZone: "UTC" };
  }
}

async function loadTarget(
  sources: LiveSources,
  companyId: string,
  now: Date,
  kpis: CompanyKpis,
): Promise<LiveTarget | null> {
  const def = await sources.weeklyTarget(companyId);
  if (!def) return null;
  const value =
    def.metricKey === "leads.qualified_delivered" || def.metricKey === "records.delivered"
      ? kpis.qualifiedDelivered
      : await sources.metricValue(companyId, def.metricKey, now);
  return value === null ? null : { ...def, value };
}

/** Null when the company does not exist. */
export async function buildLiveSummary(
  sources: LiveSources,
  companyId: string,
  now: Date = new Date(),
): Promise<LiveSummary | null> {
  const [storedZone, kpis] = await Promise.all([
    sources.timeZone(companyId),
    sources.kpis(companyId, now),
  ]);
  if (storedZone === null || kpis === null) return null;
  const { range: day, timeZone } = safeDayRange(now, storedZone);

  const [target, started, inboundQualified, waitingForStaff] = await Promise.all([
    loadTarget(sources, companyId, now, kpis),
    sources.conversationsStarted(companyId, day),
    sources.countFeedEvents(companyId, "lead_inbound_qualified", day),
    sources.openHandoffs(companyId),
  ]);

  const hourly = hourlySeries(
    started.map((c) => c.at),
    day,
    now,
    timeZone,
  );
  return {
    companyId,
    timeZone,
    generatedAt: now,
    week: {
      weekId: kpis.weekId,
      range: kpis.range,
      qualifiedDelivered: kpis.qualifiedDelivered,
      inbound: kpis.inbound,
      qualityScore: kpis.qualityScore,
      costPerQualifiedLead: kpis.costPerQualifiedLead,
      target,
    },
    today: {
      range: day,
      conversations: hourly.total,
      inboundQualified,
      waitingForStaff,
      hourly,
      sources: countBySource(
        started.filter((c) => c.at.getTime() <= now.getTime()).map((c) => c.channel),
      ),
    },
  };
}

const CONVERSATION_TYPES = [...CONVERSATION_CHANNEL_TYPES];

export const dbLiveSources: LiveSources = {
  async timeZone(companyId) {
    const row = await db.query.companies.findFirst({
      columns: { timezone: true },
      where: eq(companies.id, companyId),
    });
    return row?.timezone ?? null;
  },

  kpis: getCompanyKpis,

  async weeklyTarget(companyId) {
    const rows = await db
      .select({ weeklyTarget: workflows.weeklyTarget, metricKey: workflows.targetMetricKey })
      .from(workflows)
      .where(and(eq(workflows.companyId, companyId), isNotNull(workflows.weeklyTarget)))
      .orderBy(asc(workflows.position), asc(workflows.createdAt));
    const row = rows.find((r) => r.weeklyTarget !== null && isMetricKey(r.metricKey));
    if (!row || row.weeklyTarget === null || !isMetricKey(row.metricKey)) return null;
    return { metricKey: row.metricKey, weeklyTarget: row.weeklyTarget };
  },

  async metricValue(companyId, key, now) {
    const values = await dbMetricSource.getValues(companyId, [key], now);
    return values[key] ?? null;
  },

  async conversationsStarted(companyId, range) {
    const rows = await db
      .select({ at: chats.createdAt, channel: chats.channelType })
      .from(chats)
      .where(
        and(
          eq(chats.companyId, companyId),
          gte(chats.createdAt, range.from),
          lt(chats.createdAt, range.to),
          inArray(chats.channelType, CONVERSATION_TYPES),
        ),
      );
    return rows.flatMap((r) => (r.channel ? [{ at: r.at, channel: r.channel }] : []));
  },

  async countFeedEvents(companyId, type, range) {
    const [row] = await db
      .select({ n: count() })
      .from(portalEvents)
      .where(
        and(
          eq(portalEvents.companyId, companyId),
          eq(portalEvents.type, type),
          gte(portalEvents.at, range.from),
          lt(portalEvents.at, range.to),
        ),
      );
    return row?.n ?? 0;
  },

  async openHandoffs(companyId) {
    const [row] = await db
      .select({ n: count(), oldestAt: min(handoffRequests.createdAt) })
      .from(handoffRequests)
      .where(and(eq(handoffRequests.companyId, companyId), eq(handoffRequests.status, "open")));
    return { count: row?.n ?? 0, oldestAt: row?.oldestAt ?? null };
  },
};

export function getLiveSummary(companyId: string, now: Date = new Date()) {
  return buildLiveSummary(dbLiveSources, companyId, now);
}
