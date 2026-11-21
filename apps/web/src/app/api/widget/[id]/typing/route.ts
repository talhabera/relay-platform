import { type NextRequest } from "next/server";
import { markTyping } from "@/lib/handoff/typing";
import { clientIp } from "@/lib/rate-limit";
import { WIDGET_CORS_HEADERS, latestHandoff, resolveWidgetChat, widgetJson } from "../widget-messages";

const TYPING_CORS_HEADERS = {
  ...WIDGET_CORS_HEADERS,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
} as const;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: TYPING_CORS_HEADERS });
}

/**
 * The customer is typing in the widget (S62): `{chatId}`. Only while a person
 * has taken the conversation over, so the quick-link page can show it. The
 * widget posts at most every few seconds; presence lapses on its own.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: widgetId } = await params;
  const body: unknown = await req.json().catch(() => null);
  const chatId =
    body && typeof body === "object" && "chatId" in body && typeof body.chatId === "string"
      ? body.chatId
      : null;
  const access = await resolveWidgetChat(widgetId, chatId, clientIp(req.headers));
  if (!access.ok) return access.response;

  const handoff = await latestHandoff(access.chatId);
  if (handoff.status !== "taken_over") return widgetJson({ error: "conflict" }, 409);
  markTyping(access.chatId, "customer");
  return new Response(null, { status: 204, headers: TYPING_CORS_HEADERS });
}
