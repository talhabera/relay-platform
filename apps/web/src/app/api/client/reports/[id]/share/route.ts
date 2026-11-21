import { z } from "zod";

import { NO_STORE } from "@/app/api/reports/_lib/report-pdf";
import { loadPortalReport } from "../../_lib/load-portal-report";
import {
  SHARE_LINK_DEFAULT_DAYS,
  SHARE_LINK_MAX_DAYS,
  shareLinkExpiry,
  signReportShareToken,
} from "@/app/api/reports/_lib/share-token";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({ days: z.number().int().min(1).max(SHARE_LINK_MAX_DAYS).optional() })
  .optional();

/**
 * Create an HMAC-signed share link to one closed report's PDF (S89). Anyone
 * holding the link can open that frozen report until it expires (default 7
 * days, at most 30); nothing is stored, so the preview viewers may share too.
 */
export async function POST(req: Request, { params }: Params) {
  const raw = await req.text();
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : undefined;
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }

  const { id } = await params;
  const lookup = await loadPortalReport(id);
  if (!lookup.ok) {
    return Response.json({ error: "not_available" }, { status: lookup.status, headers: NO_STORE });
  }

  const expiresAt = shareLinkExpiry(new Date(), parsed.data?.days ?? SHARE_LINK_DEFAULT_DAYS);
  const token = signReportShareToken({
    snapshotId: lookup.report.snapshot.id,
    companyId: lookup.report.company.id,
    expiresAt,
  });
  if (!token) {
    console.error("[Reports] share links need REPORT_SHARE_SECRET or AUTH_SECRET");
    return Response.json({ error: "share_unavailable" }, { status: 503, headers: NO_STORE });
  }

  const url = new URL(`/api/reports/shared/${token}`, req.url).toString();
  return Response.json({ url, expiresAt: expiresAt.toISOString() }, { headers: NO_STORE });
}
