import { NO_STORE, reportPdfResponse } from "@/app/api/reports/_lib/report-pdf";
import { RATE_LIMIT_SURFACES, enforceSurface, rateLimitedResponse } from "@/lib/rate-limit";
import { loadPortalReport } from "../../_lib/load-portal-report";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Download one closed report as a PDF (S89): print CSS rendered by headless
 * Chromium in the worker. Same audience as `/client/reports`.
 */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const lookup = await loadPortalReport(id);
  if (!lookup.ok) {
    return Response.json({ error: "not_available" }, { status: lookup.status, headers: NO_STORE });
  }
  // Each PDF is a Chromium print in the worker: bound it per user.
  const limited = await enforceSurface(RATE_LIMIT_SURFACES.reportPdf({ userId: lookup.userId }));
  if (!limited.ok) return rateLimitedResponse(limited.denial, NO_STORE);
  await limited.release();
  return reportPdfResponse(lookup.report, "attachment");
}
