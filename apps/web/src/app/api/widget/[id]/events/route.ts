import { type NextRequest } from "next/server";
import { isTyping } from "@/lib/handoff/typing";
import { clientIp } from "@/lib/rate-limit";
import {
  WIDGET_CORS_HEADERS,
  POLL_INTERVAL_MS,
  STREAM_LIFETIME_MS,
  STREAM_RECONNECT_MS,
  findCursor,
  initialStreamState,
  latestHandoff,
  listVisibleMessagesSince,
  pollFrom,
  resolveWidgetChat,
  sseEvent,
  takeNewMessages,
  type MessageKey,
} from "../widget-messages";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: WIDGET_CORS_HEADERS });
}

/**
 * Server-sent events while the widget panel is open (S34): `message` for
 * every message the widget's own chat stream did not carry (a person's
 * message, the agent's follow-up, the expiry notice) and `handoff` when the
 * conversation's handoff state changes (`{status, person}`), and `typing`
 * `{person}` when the person who took over starts or stops typing.
 * `?chatId=…&after=<message id>`; a
 * reconnect resumes from `Last-Event-ID`.
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
  const { chatId } = access;

  const after = req.headers.get("last-event-id") ?? url.searchParams.get("after");
  const cursor = after ? await findCursor(chatId, after) : null;
  const now = new Date();
  const state = initialStreamState(cursor, now);
  const baseline: MessageKey = cursor ?? { createdAt: now, id: "￿" };

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let personTyping: boolean | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      const send = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        controller.close();
      };
      req.signal.addEventListener("abort", close);

      send(`retry: ${STREAM_RECONNECT_MS}\n\n`);

      let first = true;
      const tick = async () => {
        if (closed) return;
        try {
          const rows = await listVisibleMessagesSince(chatId, pollFrom(state));
          const fresh = takeNewMessages(state, rows, first ? baseline : undefined);
          first = false;
          for (const message of fresh) send(sseEvent("message", message, message.id));

          const handoff = await latestHandoff(chatId);
          if (handoff.status !== state.handoff) {
            state.handoff = handoff.status;
            send(sseEvent("handoff", handoff));
          }

          const typing = handoff.status === "taken_over" && isTyping(chatId, "person");
          if (typing !== personTyping) {
            personTyping = typing;
            send(sseEvent("typing", { person: typing }));
          }
        } catch (cause) {
          console.error("[Widget events] poll failed", cause);
          close();
          return;
        }
        if (Date.now() - startedAt >= STREAM_LIFETIME_MS) {
          close();
          return;
        }
        // Keeps proxies from closing an idle connection.
        send(": keep-alive\n\n");
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      };
      await tick();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      ...WIDGET_CORS_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
