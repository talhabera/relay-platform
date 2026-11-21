import { z } from "zod";
import { requireClientAccess } from "@/lib/operator/access";
import { findFeedCursor, listPortalEventsFrom } from "@/lib/live/feed";
import {
  TAIL_LIFETIME_MS,
  TAIL_POLL_INTERVAL_MS,
  TAIL_RECONNECT_MS,
  initialTailState,
  tailPollFrom,
  takeNewEvents,
} from "@/lib/live/tail";

export const dynamic = "force-dynamic";

const querySchema = z.object({ companyId: z.uuid() });

const NO_STORE = { "Cache-Control": "no-store" } as const;

function sseEvent(event: string, data: unknown, id?: string): string {
  return `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Live feed tail (S90, spec decision 7): one `portal_event` per new
 * `portal_events` row, oldest first, with the row id as the SSE id. Starts
 * after `?after=<event id>` or `Last-Event-ID` (a reconnect resumes there),
 * else after opening. The stream closes after `TAIL_LIFETIME_MS`; the browser
 * reconnects with `Last-Event-ID`. Read-only: the owner / member preview may
 * listen too.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({ companyId: url.searchParams.get("companyId") });
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  const { companyId } = parsed.data;

  try {
    await requireClientAccess(companyId);
  } catch {
    return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }

  const after = req.headers.get("last-event-id") ?? url.searchParams.get("after");
  const cursor = after ? await findFeedCursor(companyId, after) : null;
  const state = initialTailState(cursor, new Date());

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

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

      send(`retry: ${TAIL_RECONNECT_MS}\n\n`);

      const tick = async () => {
        if (closed) return;
        try {
          const rows = await listPortalEventsFrom(companyId, tailPollFrom(state));
          for (const row of takeNewEvents(state, rows)) {
            send(sseEvent("portal_event", row, row.id));
          }
        } catch (cause) {
          console.error("[Live feed] poll failed", cause);
          close();
          return;
        }
        if (Date.now() - startedAt >= TAIL_LIFETIME_MS) {
          close();
          return;
        }
        send(": keep-alive\n\n");
        timer = setTimeout(tick, TAIL_POLL_INTERVAL_MS);
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
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
