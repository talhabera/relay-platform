import { type NextRequest } from "next/server";
import {
  RATE_LIMIT_SURFACES,
  clientIp,
  enforceSurface,
  rateLimitedResponse,
} from "@/lib/rate-limit";
import {
  answerHandoffRequest,
  closeHandoffLink,
  findHandoffRequestByToken,
  handBackHandoffRequest,
  sendTakeoverMessage,
  takeOverHandoffRequest,
  type HandoffActionResult,
} from "@/lib/handoff/requests";
import { hashHandoffToken, isWellFormedHandoffToken } from "@/lib/handoff/token";
import { clearTyping, markTyping } from "@/lib/handoff/typing";
import {
  QUICK_LINK_HEADERS,
  loadQuickLinkView,
  notFound,
  quickLinkActionSchema,
  quickLinkJson,
  quickLinkState,
  type QuickLinkAction,
} from "./quick-link";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/**
 * Every request counts against the caller's IP, a wrong token included, so the
 * link space cannot be walked. Writes also count against the link itself.
 */
async function limit(req: Request, token: string, write: boolean): Promise<Response | null> {
  const ip = clientIp(req.headers);
  const link = write && isWellFormedHandoffToken(token) ? hashHandoffToken(token) : undefined;
  const result = await enforceSurface(RATE_LIMIT_SURFACES.handoffLink({ ip, link }));
  if (!result.ok) return rateLimitedResponse(result.denial, QUICK_LINK_HEADERS);
  await result.release();
  return null;
}

/** Open the quick link. Read-only: opening it twice changes nothing. */
export async function GET(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const limited = await limit(req, token, false);
  if (limited) return limited;

  const request = await findHandoffRequestByToken(token);
  if (!request) return notFound();
  return quickLinkJson(await loadQuickLinkView(request));
}

async function run(token: string, action: QuickLinkAction): Promise<HandoffActionResult> {
  switch (action.action) {
    case "answer":
      return answerHandoffRequest(token, { text: action.text, replyMode: action.replyMode });
    case "take_over":
      return takeOverHandoffRequest(token);
    case "message":
      return sendTakeoverMessage(token, action.text);
    case "hand_back":
      return handBackHandoffRequest(token);
    case "done":
      return closeHandoffLink(token);
    case "typing":
      throw new Error("typing is handled before run()");
  }
}

/**
 * One action on the link: `answer` (single answer, as the person or phrased
 * by the agent), `take_over`, `message` (during a takeover), `hand_back`,
 * `done`, or `typing` (during a takeover). Replies with the page's new state;
 * 409 when the link can no longer do that.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const body: unknown = await req.json().catch(() => null);
  const parsed = quickLinkActionSchema.safeParse(body);

  const limited = await limit(req, token, parsed.success && parsed.data.action !== "typing");
  if (limited) return limited;
  if (!isWellFormedHandoffToken(token)) return notFound();
  if (!parsed.success) return quickLinkJson({ error: "invalid_request" }, 400);
  const action = parsed.data;

  if (action.action === "typing") {
    const request = await findHandoffRequestByToken(token);
    if (!request) return notFound();
    if (!quickLinkState(request, new Date()).canWriteAsPerson) {
      return quickLinkJson({ error: "conflict" }, 409);
    }
    markTyping(request.chatId, "person");
    return new Response(null, { status: 204, headers: QUICK_LINK_HEADERS });
  }

  const result = await run(token, action);
  if (!result.ok) {
    return quickLinkJson({ error: result.error }, result.error === "not_found" ? 404 : 409);
  }
  if (action.action === "message" || action.action === "hand_back") {
    clearTyping(result.request.chatId, "person");
  }
  return quickLinkJson({
    ...(await loadQuickLinkView(result.request)),
    messageId: result.messageId ?? null,
  });
}
