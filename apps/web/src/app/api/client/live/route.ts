import { z } from "zod";
import { requireClientAccess } from "@/lib/operator/access";
import { getLiveSummary } from "@/lib/live/summary";
import { FEED_DEFAULT_LIMIT, listPortalEvents } from "@/lib/live/feed";

export const dynamic = "force-dynamic";

const querySchema = z.object({ companyId: z.uuid() });

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Live page data (S90): week-to-date KPIs, today's strip with the hourly
 * series, and the newest feed rows. The page then tails new rows from
 * `/api/client/live/events?after=<newest id>`. Client users and the owner /
 * member preview may read it (`requireClientAccess` without `mutation`).
 */
export async function GET(req: Request) {
  const parsed = querySchema.safeParse({
    companyId: new URL(req.url).searchParams.get("companyId"),
  });
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  const { companyId } = parsed.data;

  try {
    await requireClientAccess(companyId);
  } catch {
    return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }

  const [summary, events] = await Promise.all([
    getLiveSummary(companyId),
    listPortalEvents(companyId, { limit: FEED_DEFAULT_LIMIT }),
  ]);
  if (!summary) {
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }
  return Response.json({ summary, events }, { headers: NO_STORE });
}
