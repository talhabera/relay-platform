import {
  RATE_LIMIT_SURFACES,
  clientIp,
  enforceSurface,
  rateLimitedResponse,
} from "@/lib/rate-limit";
import { NO_STORE, loadSharedReport, reportPdfResponse } from "../../_lib/report-pdf";
import { verifyReportShareToken } from "../../_lib/share-token";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/**
 * Public report PDF behind an HMAC-signed share link (S89). The token is the
 * credential (public path in `auth-paths.ts`): it names one snapshot of one
 * company and an expiry. Invalid and expired links answer the same 404.
 */
export async function GET(req: Request, { params }: Params) {
  // Every request counts against the caller's IP, a bad token included: each
  // valid one is a Chromium print in the worker, so a leaked link must not be
  // able to queue prints without bound (S94 security review).
  const limited = await enforceSurface(
    RATE_LIMIT_SURFACES.reportPdfShared({ ip: clientIp(req.headers) }),
  );
  if (!limited.ok) {
    return rateLimitedResponse(limited.denial, { ...NO_STORE, "Referrer-Policy": "no-referrer" });
  }
  await limited.release();

  const { token } = await params;
  const claims = verifyReportShareToken(token);
  if (!claims) {
    return Response.json({ error: "link_invalid_or_expired" }, { status: 404, headers: NO_STORE });
  }
  const lookup = await loadSharedReport(claims.companyId, claims.snapshotId);
  if (!lookup.ok) {
    return Response.json({ error: "link_invalid_or_expired" }, { status: 404, headers: NO_STORE });
  }
  const res = await reportPdfResponse(lookup.report, "inline");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
