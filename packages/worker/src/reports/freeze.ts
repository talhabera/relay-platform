import { gte } from "drizzle-orm";
import { companies, db, reportSnapshots, REPORT_PERIODS, type ReportPeriod } from "@relay/db";
import {
  freezeReportSnapshot,
  lastClosedReportPeriod,
  reportTimeZone,
  type PeriodRange,
  type ReportExecutor,
} from "@relay/db/report-snapshots";

// Report freeze (report snapshot spec, decisions 1-2): on every cron tick, any
// company whose day, week or month closed in its own timezone gets that
// period's snapshot. The insert is idempotent, so a missed tick or a restart
// only delays the freeze; it never doubles or rewrites a snapshot.

export type FreezeCompany = { id: string; timezone: string | null; createdAt: Date };

export type FreezeDeps = {
  listCompanies(): Promise<FreezeCompany[]>;
  /** `companyId|period|startMs` keys of snapshots starting at or after `since`. */
  listFrozenKeys(since: Date): Promise<Set<string>>;
  freeze(input: {
    companyId: string;
    period: ReportPeriod;
    range: PeriodRange;
    timeZone: string;
    now: Date;
  }): Promise<string | null>;
};

export function frozenKey(companyId: string, period: ReportPeriod, start: Date): string {
  return `${companyId}|${period}|${start.getTime()}`;
}

/** Look back far enough to see the last closed month's snapshot. */
const LOOKBACK_MS = 70 * 86_400_000;

/** The closed periods at `now` that have no snapshot yet. */
export function dueReportPeriods(
  company: FreezeCompany,
  now: Date,
  frozen: ReadonlySet<string>,
): { period: ReportPeriod; range: PeriodRange; timeZone: string }[] {
  const timeZone = reportTimeZone(company.timezone);
  const due: { period: ReportPeriod; range: PeriodRange; timeZone: string }[] = [];
  for (const period of REPORT_PERIODS) {
    const range = lastClosedReportPeriod(period, now, timeZone);
    // A company created after the period closed has nothing to report for it.
    if (company.createdAt.getTime() >= range.to.getTime()) continue;
    if (frozen.has(frozenKey(company.id, period, range.from))) continue;
    due.push({ period, range, timeZone });
  }
  return due;
}

export async function freezeDueReportSnapshots(
  now: Date,
  deps: FreezeDeps = createPgFreezeDeps(db),
): Promise<{ frozen: number; failed: number }> {
  const [companyRows, frozen] = await Promise.all([
    deps.listCompanies(),
    deps.listFrozenKeys(new Date(now.getTime() - LOOKBACK_MS)),
  ]);
  let created = 0;
  let failed = 0;
  for (const company of companyRows) {
    for (const due of dueReportPeriods(company, now, frozen)) {
      try {
        const id = await deps.freeze({ companyId: company.id, ...due, now });
        if (id) created += 1;
      } catch (error) {
        failed += 1;
        console.error("report snapshot freeze failed", {
          companyId: company.id,
          period: due.period,
          error,
        });
      }
    }
  }
  return { frozen: created, failed };
}

export function createPgFreezeDeps(executor: ReportExecutor): FreezeDeps {
  return {
    async listCompanies() {
      return executor
        .select({
          id: companies.id,
          timezone: companies.timezone,
          createdAt: companies.createdAt,
        })
        .from(companies);
    },
    async listFrozenKeys(since) {
      const rows = await executor
        .select({
          companyId: reportSnapshots.companyId,
          period: reportSnapshots.period,
          start: reportSnapshots.start,
        })
        .from(reportSnapshots)
        .where(gte(reportSnapshots.start, since));
      return new Set(rows.map((r) => frozenKey(r.companyId, r.period, r.start)));
    },
    freeze(input) {
      return freezeReportSnapshot(executor, input);
    },
  };
}
