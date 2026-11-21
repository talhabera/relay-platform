import { requireSession } from "@/lib/auth-server";
import { resolvePortalCompanyId } from "@/lib/client/portal";
import { requireClientAccess, type CompanyAccessRole } from "@/lib/operator/access";
import { reportTimeZone } from "@relay/db/report-snapshots";
import { buildArchiveView, type ArchiveFilter, type ArchiveView } from "@/lib/reports/archive";
import { listReportArchive } from "@/lib/reports/read";

export type ArchivePageData =
  | { kind: "no-company" }
  | {
      kind: "archive";
      company: { id: string; name: string };
      role: CompanyAccessRole;
      view: ArchiveView;
    };

/** Session → portal company → `requireClientAccess` → closed snapshots → view model. */
export async function loadArchivePage(filter: ArchiveFilter, now: Date = new Date()): Promise<ArchivePageData> {
  const session = await requireSession();
  const companyId = await resolvePortalCompanyId(session.user.id);
  if (!companyId) return { kind: "no-company" };

  const { company, role } = await requireClientAccess(companyId);
  const entries = await listReportArchive(company.id, filter, now);
  return {
    kind: "archive",
    company: { id: company.id, name: company.name },
    role,
    view: buildArchiveView({ entries, filter, now, timeZone: reportTimeZone(company.timezone) }),
  };
}
