import { z } from "zod";
import { requireClientAccess } from "@/lib/operator/access";
import { answerNowAsCompanyUser } from "@/lib/handoff/requests";
import {
  RATE_LIMIT_SURFACES,
  enforceSurface,
  rateLimitedResponse,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  companyId: z.uuid(),
  chatId: z.uuid(),
});

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Live "Answer now" (S36 for S72): a takeover of the conversation authored by
 * the signed-in client user. Replies with a quick-link token, returned once;
 * the page then drives the takeover through `/api/h/[token]`.
 * 409 while someone else holds a takeover.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  const { companyId, chatId } = parsed.data;

  let userId: string;
  let userName: string;
  try {
    const { session } = await requireClientAccess(companyId, { mutation: true });
    userId = session.user.id;
    userName = session.user.name;
  } catch {
    return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }

  const limited = await enforceSurface(RATE_LIMIT_SURFACES.handoffAnswerNow({ userId }));
  if (!limited.ok) return rateLimitedResponse(limited.denial, NO_STORE);
  await limited.release();

  const result = await answerNowAsCompanyUser({ companyId, chatId, authorName: userName });
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 409, headers: NO_STORE },
    );
  }
  return Response.json(
    { token: result.token, url: `/h/${result.token}`, requestId: result.request.id },
    { headers: NO_STORE },
  );
}
