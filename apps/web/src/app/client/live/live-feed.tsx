"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { LiveEventRow } from "@/components/v2/client";
import { cn } from "@/lib/utils";

import { feedRow, liveHref, mergeFeed, toFeedEvent, type FeedEvent, type FeedRowView } from "./live-model";

/** KPIs follow the feed: one server refresh at most this often while events arrive. */
const REFRESH_DEBOUNCE_MS = 3_000;

export function feedStreamUrl(companyId: string, newestId: string | undefined): string {
  const query = new URLSearchParams({ companyId });
  if (newestId) query.set("after", newestId);
  return `/api/client/live/events?${query.toString()}`;
}

/** Static list, shared by the live feed and tests. */
export function FeedList({ rows, basePath }: { rows: FeedRowView[]; basePath: string }) {
  if (rows.length === 0) {
    return (
      <p data-slot="live-feed-empty" className="px-4 py-6 type-small text-muted-foreground">
        Nothing yet today. New leads, handoffs and conversations show up here as they happen.
      </p>
    );
  }
  return (
    <ol className="flex flex-col">
      {rows.map((row, index) => {
        const last = index === rows.length - 1;
        const item = (
          <LiveEventRow
            kind={row.kind}
            time={row.time}
            text={row.text}
            detail={row.detail}
            source={row.source}
            className={cn(last && "border-b-0")}
          />
        );
        return (
          <li key={row.id} data-event-id={row.id}>
            {row.openable ? (
              <Link
                href={liveHref(basePath, { event: row.id })}
                scroll={false}
                className="block rounded-md outline-none hover:bg-accent focus-visible:shadow-focus-ring"
              >
                {item}
              </Link>
            ) : (
              item
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Figma 11b `Feed` ("Today's feed", newest first). Starts from the server's
 * newest rows and tails `/api/client/live/events` (S90): the stream closes after
 * 55 s and EventSource reconnects with `Last-Event-ID`.
 */
export function LiveFeed({
  companyId,
  initialEvents,
  timeZone,
  basePath,
}: {
  companyId: string;
  initialEvents: FeedEvent[];
  timeZone: string;
  basePath: string;
}) {
  const router = useRouter();
  const [received, setReceived] = React.useState<FeedEvent[]>([]);
  const events = mergeFeed(received, initialEvents);
  const newestInitialId = initialEvents[0]?.id;

  React.useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(feedStreamUrl(companyId, newestInitialId));
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const onEvent = (message: MessageEvent<string>) => {
      try {
        const event = toFeedEvent(JSON.parse(message.data) as FeedEvent);
        setReceived((prev) => mergeFeed([event], prev));
      } catch {
        return;
      }
      if (!refresh) {
        refresh = setTimeout(() => {
          refresh = undefined;
          router.refresh();
        }, REFRESH_DEBOUNCE_MS);
      }
    };
    source.addEventListener("portal_event", onEvent as EventListener);
    return () => {
      source.removeEventListener("portal_event", onEvent as EventListener);
      source.close();
      if (refresh) clearTimeout(refresh);
    };
    // The stream is opened once per company; later server rows arrive through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  return (
    <section
      data-slot="live-feed"
      aria-live="polite"
      className="flex w-full flex-col rounded-xl border border-border bg-card px-4 pt-3 pb-2 shadow-elevation-1 lg:w-130 lg:shrink-0"
    >
      <div className="flex items-center pb-2">
        <h2 className="type-h3 text-foreground">Today&apos;s feed</h2>
        <span className="flex-1" />
        <span className="type-caption text-muted-foreground">Newest first</span>
      </div>
      <FeedList rows={events.map((e) => feedRow(e, timeZone))} basePath={basePath} />
    </section>
  );
}
