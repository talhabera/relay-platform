import { type NextRequest } from "next/server";
import { clientIp } from "@/lib/rate-limit";
import {
  WIDGET_CORS_HEADERS,
  findCursor,
  latestHandoff,
  listMissedMessages,
  resolveWidgetChat,
  widgetJson,
} from "../widget-messages";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: WIDGET_CORS_HEADERS });
}

/**
 * Missed messages on reopen: `?chatId=…&after=<last message id the widget
 * has>`. Without `after`, the latest page of the transcript. Also returns the
 * conversation's handoff state (and the colleague it went to) so the widget
 * can show waiting / taken over.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: widgetId } = await params;
  const url = new URL(req.url);
  const access = await resolveWidgetChat(
    widgetId,
    url.searchParams.get("chatId"),
    clientIp(req.headers),
  );
  if (!access.ok) return access.response;

  const after = url.searchParams.get("after");
  const cursor = after ? await findCursor(access.chatId, after) : null;
  const [messages, handoff] = await Promise.all([
    listMissedMessages(access.chatId, cursor),
    latestHandoff(access.chatId),
  ]);
  return widgetJson({ messages, handoff: handoff.status, handoffPerson: handoff.person });
}
