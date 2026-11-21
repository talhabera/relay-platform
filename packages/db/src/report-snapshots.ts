import { and, desc, eq, gte, inArray, isNotNull, lt, or } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { agents } from "./schema/agents";
import { chats } from "./schema/chats";
import { companyRecords } from "./schema/company-records";
import { handoffRequests } from "./schema/handoff";
import { leadEvents } from "./schema/lead-events";
import {
  reportSnapshots,
  type NarrativeReportPeriod,
  type ReportNarrative,
  type ReportPeriod,
  type ReportSnapshotMetric,
  type ReportSnapshotSeries,
} from "./schema/report-snapshots";
import {
  deliveredSeriesBuckets,
  previousReportPeriod,
  type PeriodRange,
} from "./report-periods";

export {
  deliveredSeriesBuckets,
  isoWeekLabel,
  lastClosedReportPeriod,
  localDateLabel,
  previousReportPeriod,
  reportPeriodRange,
  reportTimeZone,
  type PeriodRange,
} from "./report-periods";

// Report snapshot aggregators (spec 2026-10-02-report-snapshots-and-live-feed,
// decisions 4-6). `buildReportSnapshot` is pure: it decides what counts. The
// loader fetches the rows it needs; the writers insert a frozen snapshot once
// and let Insights add only the narrative.
//
// Lead counting follows `apps/web/src/lib/metrics/compute.ts` (S23): distinct
// leads per bucket, a lead counts as delivered once, on its first delivery.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReportExecutor = PgDatabase<PgQueryResultHKT, any, any>;

/**
 * Phase 1 metric keys that have a data source (decision 5), in card order.
 * Site visits, reviews, posts, reply times, cost per qualified lead and
 * "resolved without staff" join as their sources land; until then they are
 * absent from `metrics`, so their cards stay hidden.
 */
export const REPORT_METRIC_KEYS = [
  "conversations.started",
  "leads.inbound",
  "leads.qualified_delivered",
  "handoff.staff_answers",
  "leads.quality_score",
  "records.gathered",
  "records.qualified",
  "records.contacted_replied",
  "records.delivered",
] as const;
export type ReportMetricKey = (typeof REPORT_METRIC_KEYS)[number];

/** Customer-facing channels: a conversation with a customer, not a session. */
export const REPORT_CONVERSATION_CHANNEL_TYPES = [
  "whatsapp",
  "instagram",
  "telegram",
  "messenger",
  "widget",
] as const;

/** Lead statuses per funnel bucket; same lists as S23's `LEAD_STATUS_BUCKETS`. */
export const REPORT_LEAD_STATUS_BUCKETS = {
  gathered: ["gathered"],
  qualified: ["qualified"],
  contacted: ["contacted", "outreach_approved", "replied"],
  delivered: ["delivered"],
} as const satisfies Record<string, readonly string[]>;

export type ReportLeadEventFact = {
  recordId: string;
  fromStatus: string | null;
  toStatus: string;
  agentId: string | null;
  at: Date;
};

/** Everything the aggregator reads for one period and the one before it. */
export type ReportFacts = {
  /** Events in `[previous.from, range.to)` plus every earlier delivered event. */
  leadEvents: readonly ReportLeadEventFact[];
  customerAgentIds: ReadonlySet<string>;
  /** Fit scores of delivered leads; null when unscored. */
  scores: ReadonlyMap<string, number | null>;
  /** Customer conversations started (chat creation times). */
  conversationsAt: readonly Date[];
  /** Handoff requests answered by staff (answer times). */
  staffAnswersAt: readonly Date[];
};

const has = (list: readonly string[], status: string) => list.includes(status);

function inRange(at: Date, range: PeriodRange): boolean {
  const t = at.getTime();
  return t >= range.from.getTime() && t < range.to.getTime();
}

function isInbound(e: ReportLeadEventFact, customer: ReadonlySet<string>): boolean {
  return e.fromStatus === null && e.agentId !== null && customer.has(e.agentId);
}

/** First delivery of each lead, kept only when it falls inside `range`. */
function firstDelivered(
  events: readonly ReportLeadEventFact[],
  range: PeriodRange,
): Map<string, Date> {
  const first = new Map<string, Date>();
  for (const e of events) {
    if (!has(REPORT_LEAD_STATUS_BUCKETS.delivered, e.toStatus)) continue;
    if (e.at.getTime() >= range.to.getTime()) continue;
    const seen = first.get(e.recordId);
    if (!seen || e.at.getTime() < seen.getTime()) first.set(e.recordId, e.at);
  }
  first.forEach((at, id) => {
    if (!inRange(at, range)) first.delete(id);
  });
  return first;
}

type PeriodValues = Record<ReportMetricKey, number | null> & {
  deliveredAt: Map<string, Date>;
};

function periodValues(facts: ReportFacts, range: PeriodRange): PeriodValues {
  const gathered = new Set<string>();
  const qualified = new Set<string>();
  const contacted = new Set<string>();
  const inbound = new Set<string>();
  for (const e of facts.leadEvents) {
    if (!inRange(e.at, range)) continue;
    const inboundEvent = isInbound(e, facts.customerAgentIds);
    if (inboundEvent) inbound.add(e.recordId);
    if (
      has(REPORT_LEAD_STATUS_BUCKETS.gathered, e.toStatus) ||
      (e.fromStatus === null && !inboundEvent)
    ) {
      gathered.add(e.recordId);
    }
    if (has(REPORT_LEAD_STATUS_BUCKETS.qualified, e.toStatus)) qualified.add(e.recordId);
    if (has(REPORT_LEAD_STATUS_BUCKETS.contacted, e.toStatus)) contacted.add(e.recordId);
  }
  const deliveredAt = firstDelivered(facts.leadEvents, range);
  const scored = Array.from(deliveredAt.keys())
    .map((id) => facts.scores.get(id))
    .filter((s): s is number => typeof s === "number");
  const quality =
    scored.length === 0
      ? null
      : Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
  return {
    "conversations.started": facts.conversationsAt.filter((at) => inRange(at, range)).length,
    "leads.inbound": inbound.size,
    "leads.qualified_delivered": deliveredAt.size,
    "handoff.staff_answers": facts.staffAnswersAt.filter((at) => inRange(at, range)).length,
    "leads.quality_score": quality,
    "records.gathered": gathered.size,
    "records.qualified": qualified.size,
    "records.contacted_replied": contacted.size,
    "records.delivered": deliveredAt.size,
    deliveredAt,
  };
}

export type BuiltReportSnapshot = {
  metrics: ReportSnapshotMetric[];
  series: ReportSnapshotSeries;
};

/**
 * Metrics (with `previous`) and series for one closed period. A metric whose
 * current value is null (quality with nothing scored delivered) is left out:
 * its card is hidden rather than shown empty.
 */
export function buildReportSnapshot(
  period: ReportPeriod,
  range: PeriodRange,
  timeZone: string,
  facts: ReportFacts,
): BuiltReportSnapshot {
  const previousRange = previousReportPeriod(period, range, timeZone);
  const current = periodValues(facts, range);
  const previous = periodValues(facts, previousRange);

  const metrics: ReportSnapshotMetric[] = [];
  for (const key of REPORT_METRIC_KEYS) {
    const value = current[key];
    if (value === null) continue;
    metrics.push({ metricKey: key, value, previous: previous[key] });
  }

  const delivered = deliveredSeriesBuckets(period, range, timeZone).map((b) => ({
    label: b.label,
    value: Array.from(current.deliveredAt.values()).filter((at) => inRange(at, b.range)).length,
  }));

  return {
    metrics,
    series: {
      delivered,
      funnel: [
        { stage: "gathered", value: current["records.gathered"] ?? 0 },
        { stage: "qualified", value: current["records.qualified"] ?? 0 },
        { stage: "contacted", value: current["records.contacted_replied"] ?? 0 },
        { stage: "delivered", value: current["records.delivered"] ?? 0 },
      ],
    },
  };
}

/** Rows the aggregator needs for `range` and the period before it. */
export async function loadReportFacts(
  db: ReportExecutor,
  companyId: string,
  period: ReportPeriod,
  range: PeriodRange,
  timeZone: string,
): Promise<ReportFacts> {
  const from = previousReportPeriod(period, range, timeZone).from;
  const to = range.to;
  const delivered = REPORT_LEAD_STATUS_BUCKETS.delivered as readonly string[];

  const [events, agentRows, chatRows, answerRows] = await Promise.all([
    db
      .select({
        recordId: leadEvents.recordId,
        fromStatus: leadEvents.fromStatus,
        toStatus: leadEvents.toStatus,
        agentId: leadEvents.agentId,
        at: leadEvents.at,
      })
      .from(leadEvents)
      .where(
        and(
          eq(leadEvents.companyId, companyId),
          lt(leadEvents.at, to),
          or(
            gte(leadEvents.at, from),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            inArray(leadEvents.toStatus, delivered as any[]),
          ),
        ),
      ),
    db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.kind, "customer"))),
    db
      .select({ createdAt: chats.createdAt })
      .from(chats)
      .where(
        and(
          eq(chats.companyId, companyId),
          inArray(chats.channelType, [...REPORT_CONVERSATION_CHANNEL_TYPES]),
          gte(chats.createdAt, from),
          lt(chats.createdAt, to),
        ),
      ),
    db
      .select({ answeredAt: handoffRequests.answeredAt })
      .from(handoffRequests)
      .where(
        and(
          eq(handoffRequests.companyId, companyId),
          isNotNull(handoffRequests.answeredAt),
          gte(handoffRequests.answeredAt, from),
          lt(handoffRequests.answeredAt, to),
        ),
      ),
  ]);

  const deliveredIds = Array.from(
    new Set(events.filter((e) => has(delivered, e.toStatus)).map((e) => e.recordId)),
  );
  const scoreRows =
    deliveredIds.length === 0
      ? []
      : await db
          .select({ id: companyRecords.id, score: companyRecords.score })
          .from(companyRecords)
          .where(
            and(
              eq(companyRecords.companyId, companyId),
              inArray(companyRecords.id, deliveredIds),
            ),
          );

  return {
    leadEvents: events,
    customerAgentIds: new Set(agentRows.map((a) => a.id)),
    scores: new Map(scoreRows.map((r) => [r.id, r.score])),
    conversationsAt: chatRows.map((c) => c.createdAt),
    staffAnswersAt: answerRows
      .map((r) => r.answeredAt)
      .filter((at): at is Date => at !== null),
  };
}

/**
 * Aggregate and insert the snapshot of one closed period. Idempotent: a
 * second call for the same company, period and start is a no-op (the unique
 * index keeps the first frozen row). Returns the new row's id, or null.
 */
export async function freezeReportSnapshot(
  db: ReportExecutor,
  input: {
    companyId: string;
    period: ReportPeriod;
    range: PeriodRange;
    timeZone: string;
    now?: Date;
  },
): Promise<string | null> {
  const { companyId, period, range, timeZone } = input;
  if ((input.now ?? new Date()).getTime() < range.to.getTime()) {
    throw new RangeError("A report snapshot is frozen only after its period closes");
  }
  const facts = await loadReportFacts(db, companyId, period, range, timeZone);
  const built = buildReportSnapshot(period, range, timeZone, facts);
  const rows = await db
    .insert(reportSnapshots)
    .values({
      companyId,
      period,
      start: range.from,
      end: range.to,
      metrics: built.metrics,
      series: built.series,
      frozenAt: input.now ?? new Date(),
    })
    .onConflictDoNothing({
      target: [reportSnapshots.companyId, reportSnapshots.period, reportSnapshots.start],
    })
    .returning({ id: reportSnapshots.id });
  return rows[0]?.id ?? null;
}

export class ReportNarrativeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportNarrativeError";
  }
}

const MAX_SUMMARY = 2000;
const MAX_HIGHLIGHTS = 8;
const MAX_HIGHLIGHT = 400;

/** Trims and bounds a narrative; refuses an empty summary. */
export function normalizeReportNarrative(input: ReportNarrative): ReportNarrative {
  const summary = input.summary.trim();
  if (!summary) throw new ReportNarrativeError("The summary is empty");
  if (summary.length > MAX_SUMMARY) {
    throw new ReportNarrativeError(`The summary is longer than ${MAX_SUMMARY} characters`);
  }
  const highlights = input.highlights.map((h) => h.trim()).filter(Boolean);
  if (highlights.length > MAX_HIGHLIGHTS) {
    throw new ReportNarrativeError(`At most ${MAX_HIGHLIGHTS} highlights`);
  }
  if (highlights.some((h) => h.length > MAX_HIGHLIGHT)) {
    throw new ReportNarrativeError(`A highlight is longer than ${MAX_HIGHLIGHT} characters`);
  }
  return { summary, highlights };
}

/**
 * Insights writes the summary and Highlights onto the company's latest
 * weekly or monthly snapshot (decision 1). Only `narrative` changes; the
 * numbers stay frozen. Returns the snapshot written, or null when the company
 * has no closed snapshot of that period yet.
 */
export async function writeReportNarrative(
  db: ReportExecutor,
  input: {
    companyId: string;
    period: NarrativeReportPeriod;
    narrative: ReportNarrative;
  },
): Promise<{ id: string; start: Date; end: Date } | null> {
  if (input.period !== "weekly" && input.period !== "monthly") {
    throw new ReportNarrativeError("Only weekly and monthly reports carry a narrative");
  }
  const narrative = normalizeReportNarrative(input.narrative);
  const [latest] = await db
    .select({ id: reportSnapshots.id })
    .from(reportSnapshots)
    .where(
      and(
        eq(reportSnapshots.companyId, input.companyId),
        eq(reportSnapshots.period, input.period),
      ),
    )
    .orderBy(desc(reportSnapshots.start))
    .limit(1);
  if (!latest) return null;
  const [row] = await db
    .update(reportSnapshots)
    .set({ narrative })
    .where(eq(reportSnapshots.id, latest.id))
    .returning({
      id: reportSnapshots.id,
      start: reportSnapshots.start,
      end: reportSnapshots.end,
    });
  return row ?? null;
}
