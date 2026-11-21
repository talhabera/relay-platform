import { getSession } from "@/lib/auth-server";

import { resolveAnalyticsAccess } from "../_overview/analytics-access";
import { loadLeadQuality, loadOverview, weekStartDate } from "../_overview/load-overview";
import { EXPORT_VIEWS, parseAnalyticsView, parseWeekChoice, weekDaysLabel } from "../_overview/overview-model";
import { leadQualityReportCsv, overviewReportCsv, reportFileName } from "../_overview/report-csv";

/**
 * Analytics "Export report": the Overview or Lead quality numbers of the
 * selected week as CSV. Same company and `analytics` page permission as the
 * page (owner, or a member granted Analytics); the company is the active one,
 * never a request parameter.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const access = await resolveAnalyticsAccess(session.user.id);
  if (access.kind === "no-company") return new Response("Not found", { status: 404 });
  if (access.kind === "restricted") return new Response("Forbidden", { status: 403 });

  const params = new URL(request.url).searchParams;
  const view = parseAnalyticsView(params.get("view") ?? undefined);
  if (!EXPORT_VIEWS.has(view)) return new Response("Export covers Overview and Lead quality", { status: 400 });
  const week = parseWeekChoice(params.get("week") ?? undefined);

  let csv: string;
  let weekStart: string;
  if (view === "lead-quality") {
    const data = await loadLeadQuality(access.company.id, week);
    if (!data) return new Response("Not found", { status: 404 });
    csv = leadQualityReportCsv(data.model, weekDaysLabel(data.week, data.timeZone));
    weekStart = weekStartDate(data.week, data.timeZone);
  } else {
    const data = await loadOverview(access.company.id, week);
    if (!data) return new Response("Not found", { status: 404 });
    csv = overviewReportCsv(data.model, weekDaysLabel(data.week, data.timeZone));
    weekStart = weekStartDate(data.week, data.timeZone);
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${reportFileName(view, weekStart)}"`,
      "Cache-Control": "no-store",
    },
  });
}
