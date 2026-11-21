import { db } from "@/db";
import { requireCompanyAccess } from "@/lib/authorization";
import {
  buildOfflineConversionsCsv,
  loadOfflineConversions,
  resolveExportRange,
} from "@/lib/ads/offline-conversions";

export const runtime = "nodejs";

/**
 * Google Ads offline conversions CSV for one company (owner only). The company
 * is the route param confirmed by `requireCompanyAccess`, never a query value.
 * Read-only; click ids never reach a header or a log line.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let company;
  try {
    ({ company } = await requireCompanyAccess(id));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!company) {
    return new Response("Not found", { status: 404 });
  }

  // The schema default is UTC; exporting with it would shift every conversion time.
  if (company.timezone === "UTC") {
    return Response.json({ error: "timezone_not_set" }, { status: 409 });
  }

  const search = new URL(request.url).searchParams;
  const range = resolveExportRange({
    from: search.get("from"),
    to: search.get("to"),
    timeZone: company.timezone,
    now: new Date(),
  });
  if (!range.ok) {
    return Response.json({ error: range.error }, { status: 400 });
  }

  const { rows, skipped } = await loadOfflineConversions(db, {
    companyId: company.id,
    from: range.from,
    to: range.to,
  });
  const csv = buildOfflineConversionsCsv({ timeZone: company.timezone, rows });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="koleva-offline-conversions-${range.fromDay}-${range.toDay}.csv"`,
      "Cache-Control": "no-store",
      "X-Export-Rows": String(rows.length),
      "X-Export-Skipped-No-Click": String(skipped.noGoogleClick),
      "X-Export-Skipped-Invalid": String(skipped.invalidClickId),
      "X-Export-Skipped-Wbraid": String(skipped.wbraidOnly),
    },
  });
}
