import { type NextRequest } from "next/server";
import {
  RATE_LIMIT_SURFACES,
  clientIp,
  enforceSurface,
  rateLimitedResponse,
} from "@/lib/rate-limit";
import { findHandoffRequestByToken } from "@/lib/handoff/requests";
import { isTyping } from "@/lib/handoff/typing";
import {
  POLL_INTERVAL_MS,
  STREAM_LIFETIME_MS,
  STREAM_RECONNECT_MS,
  findCursor,
  initialStreamState,
  listVisibleMessagesSince,
  pollFrom,
  sseEvent,
  toWidgetMessage,
  isAfter,
  type MessageKey,
} from "@/app/api/widget/[id]/widget-messages";
import { QUICK_LINK_HEADERS, notFound, publicRequest, quickLinkState } from "../quick-link";

export const dynamic = "force-dynamic";

/**
 * Live transcript for the quick-link page (S36): `message` for every customer-
 * visible message after `?after=<message id>` (or after opening), `handoff`
 * with the request and link state whenever either changes, and `typing`
 * `{customer}` when the customer starts or stops typing. A reconnect resumes
 * from `Last-Event-ID`. The stream ends once the link may no longer show the
 * conversation (expired, Done, handed back after the deadline).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = await enforceSurface(
    RATE_LIMIT_SURFACES.handoffLink({ ip: clientIp(req.headers) }),
  );
  if (!limited.ok) return rateLimitedResponse(limited.denial, QUICK_LINK_HEADERS);
  await limited.release();

  const request = await findHandoffRequestByToken(token);
  if (!request) return notFound();
  if (!quickLinkState(request, new Date()).canView) {
    return Response.json({ error: "gone" }, { status: 410, headers: QUICK_LINK_HEADERS });
  }
  const chatId = request.chatId;

  const url = new URL(req.url);
  const after = req.headers.get("last-event-id") ?? url.searchParams.get("after");
  const cursor = after ? await findCursor(chatId, after) : null;
  const now = new Date();
  const state = initialStreamState(cursor, now);
  const baseline: MessageKey = cursor ?? { createdAt: now, id: "￿" };

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let lastHandoff = "";
  let customerTyping: boolean | undefined;

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
          const current = await findHandoffRequestByToken(token);
          if (!current) {
            close();
            return;
          }
          const link = quickLinkState(current, new Date());
          const handoff = JSON.stringify({ request: publicRequest(current), link });
          if (handoff !== lastHandoff) {
            lastHandoff = handoff;
            send(`event: handoff\ndata: ${handoff}\n\n`);
          }
          if (!link.canView) {
            close();
            return;
          }

          const rows = await listVisibleMessagesSince(chatId, pollFrom(state));
          for (const row of rows) {
            if (state.seen.has(row.id)) continue;
            state.seen.add(row.id);
            if (row.createdAt > state.highWater) state.highWater = row.createdAt;
            if (first && !isAfter(row, baseline)) continue;
            send(sseEvent("message", toWidgetMessage(row), row.id));
          }
          first = false;

          const typing = isTyping(chatId, "customer");
          if (typing !== customerTyping) {
            customerTyping = typing;
            send(sseEvent("typing", { customer: typing }));
          }
        } catch (cause) {
          console.error("[Quick link events] poll failed", cause);
          close();
          return;
        }
        if (Date.now() - startedAt >= STREAM_LIFETIME_MS) {
          close();
          return;
        }
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
      ...QUICK_LINK_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
