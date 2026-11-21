import { requireSession } from "@/lib/auth-server";
import { resolvePortalCompanyId } from "@/lib/client/portal";
import { requireClientAccess } from "@/lib/operator/access";
import { getReportSnapshot } from "@/lib/reports/read";

import type { PrintableReport, ReportLookup } from "@/app/api/reports/_lib/report-pdf";

/** A portal lookup also names the viewer, for per-user rate limits. */
export type PortalReportLookup =
  | (Extract<ReportLookup, { ok: true }> & { userId: string })
  | Extract<ReportLookup, { ok: false }>;

/**
 * A closed snapshot of the viewer's portal company: client users and the
 * owner / member read-only preview (`requireClientAccess`, as `/client/reports`).
 */
export async function loadPortalReport(snapshotId: string): Promise<PortalReportLookup> {
  let companyId: string | null;
  let userId: string;
  try {
    const session = await requireSession();
    userId = session.user.id;
    companyId = await resolvePortalCompanyId(session.user.id);
  } catch {
    return { ok: false, status: 401 };
  }
  if (!companyId) return { ok: false, status: 403 };

  let company: PrintableReport["company"];
  try {
    ({ company } = await requireClientAccess(companyId));
  } catch {
    return { ok: false, status: 403 };
  }
  const snapshot = await getReportSnapshot(company.id, snapshotId);
  if (!snapshot) return { ok: false, status: 404 };
  return { ok: true, report: { snapshot, company }, userId };
}
