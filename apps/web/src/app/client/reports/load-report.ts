import { requireSession } from "@/lib/auth-server";
import { resolvePortalCompanyId } from "@/lib/client/portal";
import type { ReportPeriod } from "@/lib/fixtures/interfaces";
import { requireClientAccess, type CompanyAccessRole } from "@/lib/operator/access";
import { reportTimeZone } from "@relay/db/report-snapshots";
import { findReportPage } from "@/lib/reports/read";
import { buildReportView, reportsHref, type ReportView } from "@/lib/reports/view";

const PERIODS: readonly ReportPeriod[] = ["daily", "weekly", "monthly"];

export type ReportsSearch = { period: ReportPeriod; id: string | null };

/** `?period=daily|weekly|monthly&id=<snapshot id>`; Daily by default (Figma lands there). */
export function parseReportsSearch(params: Record<string, string | string[] | undefined>): ReportsSearch {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const period = one(params.period);
  const id = one(params.id);
  return {
    period: PERIODS.includes(period as ReportPeriod) ? (period as ReportPeriod) : "daily",
    id: id && id.length <= 64 ? id : null,
  };
}

export { reportsHref };

export type ReportsPageData =
  | { kind: "no-company" }
  | {
      kind: "report";
      company: { id: string; name: string };
      role: CompanyAccessRole;
      period: ReportPeriod;
      /** Null when no closed period of this kind exists yet. */
      view: ReportView | null;
      previousHref: string | null;
      nextHref: string | null;
    };

/** Session → portal company → `requireClientAccess` → snapshot → view model. */
export async function loadReportsPage(search: ReportsSearch): Promise<ReportsPageData> {
  const session = await requireSession();
  const companyId = await resolvePortalCompanyId(session.user.id);
  if (!companyId) return { kind: "no-company" };

  const { company, role } = await requireClientAccess(companyId);
  const page = await findReportPage(company.id, search.period, search.id);
  return {
    kind: "report",
    company: { id: company.id, name: company.name },
    role,
    period: search.period,
    view: page ? buildReportView(page.snapshot, reportTimeZone(company.timezone)) : null,
    previousHref: page?.previousId ? reportsHref(search.period, page.previousId) : null,
    nextHref: page?.nextId ? reportsHref(search.period, page.nextId) : null,
  };
}
