import { and, asc, desc, eq, gt, lt, lte } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import { db } from "@/db";
import { reportSnapshots } from "@/db/schema";
import type {
  MetricKey,
  ReportPeriod,
  ReportSnapshot,
  ReportsReader,
} from "@/lib/fixtures/interfaces";

// Read side of report snapshots (S70). The cron service freezes rows
// (`@relay/db/report-snapshots`); the portal only reads them. Every query is
// scoped by company and by `period_end <= now`, so Reports shows closed
// periods only (report snapshot spec, decision 3). Callers authorize first
// (`requireClientAccess`).

type ReportSnapshotRow = InferSelectModel<typeof reportSnapshots>;

/** Row to the screen-facing `ReportSnapshot` (same shape, typed metric keys). */
export function toReportSnapshot(row: ReportSnapshotRow): ReportSnapshot {
  return {
    id: row.id,
    companyId: row.companyId,
    period: row.period,
    start: row.start,
    end: row.end,
    metrics: row.metrics.map((m) => ({
      metricKey: m.metricKey as MetricKey,
      value: m.value,
      previous: m.previous,
    })),
    series: {
      delivered: row.series?.delivered ?? [],
      funnel: row.series?.funnel ?? [],
    },
    narrative: row.narrative ?? null,
    frozenAt: row.frozenAt,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function closed(companyId: string, period: ReportPeriod, now: Date) {
  return and(
    eq(reportSnapshots.companyId, companyId),
    eq(reportSnapshots.period, period),
    lte(reportSnapshots.end, now),
  );
}

export async function listReportSnapshots(
  companyId: string,
  period: ReportPeriod,
  now: Date = new Date(),
): Promise<ReportSnapshot[]> {
  const rows = await db
    .select()
    .from(reportSnapshots)
    .where(closed(companyId, period, now))
    .orderBy(desc(reportSnapshots.start));
  return rows.map(toReportSnapshot);
}

export async function getReportSnapshot(
  companyId: string,
  id: string,
  now: Date = new Date(),
): Promise<ReportSnapshot | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db
    .select()
    .from(reportSnapshots)
    .where(
      and(
        eq(reportSnapshots.companyId, companyId),
        eq(reportSnapshots.id, id),
        lte(reportSnapshots.end, now),
      ),
    )
    .limit(1);
  return row ? toReportSnapshot(row) : null;
}

/** One archive row: a closed snapshot without its figures. */
export type ReportArchiveEntry = Pick<ReportSnapshot, "id" | "period" | "start" | "end" | "frozenAt">;

/** Archive cap: about three months of dailies plus their weeklies and monthlies. */
export const REPORT_ARCHIVE_LIMIT = 120;

/**
 * Closed snapshots for the archive (S71), newest first; every period, or one
 * when `period` is set. Figures are not read: the archive only lists reports.
 */
export async function listReportArchive(
  companyId: string,
  period: ReportPeriod | null,
  now: Date = new Date(),
  limit: number = REPORT_ARCHIVE_LIMIT,
): Promise<ReportArchiveEntry[]> {
  return db
    .select({
      id: reportSnapshots.id,
      period: reportSnapshots.period,
      start: reportSnapshots.start,
      end: reportSnapshots.end,
      frozenAt: reportSnapshots.frozenAt,
    })
    .from(reportSnapshots)
    .where(
      period
        ? closed(companyId, period, now)
        : and(eq(reportSnapshots.companyId, companyId), lte(reportSnapshots.end, now)),
    )
    .orderBy(desc(reportSnapshots.end), desc(reportSnapshots.start))
    .limit(limit);
}

export const reportsReader: ReportsReader = {
  listReportSnapshots: (companyId, period) => listReportSnapshots(companyId, period),
  getReportSnapshot: (companyId, id) => getReportSnapshot(companyId, id),
};

export type ReportPage = {
  snapshot: ReportSnapshot;
  /** The closed period before / after this one, for the header stepper. */
  previousId: string | null;
  nextId: string | null;
};

/**
 * The report to show for `period`: the snapshot `id` when it belongs to the
 * company and that period, else the newest closed one. Null when the company
 * has no closed snapshot of that period yet.
 */
export async function findReportPage(
  companyId: string,
  period: ReportPeriod,
  id?: string | null,
  now: Date = new Date(),
): Promise<ReportPage | null> {
  let snapshot = id ? await getReportSnapshot(companyId, id, now) : null;
  if (snapshot && snapshot.period !== period) snapshot = null;
  if (!snapshot) {
    const [row] = await db
      .select()
      .from(reportSnapshots)
      .where(closed(companyId, period, now))
      .orderBy(desc(reportSnapshots.start))
      .limit(1);
    snapshot = row ? toReportSnapshot(row) : null;
  }
  if (!snapshot) return null;

  const [previous, next] = await Promise.all([
    db
      .select({ id: reportSnapshots.id })
      .from(reportSnapshots)
      .where(and(closed(companyId, period, now), lt(reportSnapshots.start, snapshot.start)))
      .orderBy(desc(reportSnapshots.start))
      .limit(1),
    db
      .select({ id: reportSnapshots.id })
      .from(reportSnapshots)
      .where(and(closed(companyId, period, now), gt(reportSnapshots.start, snapshot.start)))
      .orderBy(asc(reportSnapshots.start))
      .limit(1),
  ]);
  return { snapshot, previousId: previous[0]?.id ?? null, nextId: next[0]?.id ?? null };
}
