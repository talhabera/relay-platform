import { notFound, redirect } from "next/navigation";

import { NoCompanyState, SystemStateFrame } from "@/components/v2/shell";

import { ClientPortalHeader } from "../portal-header";

import { ConversationSheet } from "./conversation-sheet";
import { LiveFeed } from "./live-feed";
import { LIVE_PATH, LIVE_PREVIEW_PATH, liveHref, PREVIEW_EXIT_HREF, type LiveSearch } from "./live-model";
import { LiveCharts, LiveGoalStrip, LiveTitle, PreviewBar, TodayMetrics } from "./live-view";
import { loadLivePage } from "./load-live";

/**
 * Client portal Live (S72, Figma 11b `500:69276`). `/client/live` is the client
 * user's page; `/client/live/preview` is the owner / member read-only preview
 * (`11/live/preview`). Each role is sent to its own path.
 */
export async function LivePage({ search, preview }: { search: LiveSearch; preview: boolean }) {
  const data = await loadLivePage(search);

  if (data.kind === "no-company") {
    return (
      <SystemStateFrame>
        <NoCompanyState isOwner={false} />
      </SystemStateFrame>
    );
  }
  if (data.kind === "not-found") notFound();

  if (preview && !data.readOnly) redirect(LIVE_PATH);
  if (!preview && data.readOnly) redirect(LIVE_PREVIEW_PATH);

  const base = preview ? LIVE_PREVIEW_PATH : LIVE_PATH;
  const { summary } = data;

  return (
    <div className="min-h-svh bg-background">
      {preview ? <PreviewBar companyName={data.company.name} exitHref={PREVIEW_EXIT_HREF} /> : null}
      <ClientPortalHeader active="live" company={data.company} hrefs={preview ? { live: LIVE_PREVIEW_PATH } : undefined} />
      <main className="mx-auto flex w-full max-w-360 flex-col gap-3 px-4 pb-6 sm:px-8">
        <LiveTitle generatedAt={summary.generatedAt} timeZone={summary.timeZone} />
        <LiveGoalStrip summary={summary} />
        <TodayMetrics
          summary={summary}
          waitingOldest={data.waitingOldest}
          waitingHref={data.waitingOldest ? liveHref(base, { chat: data.waitingOldest.chatId }) : null}
          now={data.now}
        />
        <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-stretch">
          <LiveCharts summary={summary} />
          <LiveFeed
            companyId={data.company.id}
            initialEvents={data.events}
            timeZone={summary.timeZone}
            basePath={base}
          />
        </div>
      </main>
      {data.conversation ? (
        <ConversationSheet
          key={data.conversation.chatId}
          view={data.conversation}
          companyId={data.company.id}
          readOnly={data.readOnly}
          closeHref={base}
        />
      ) : null}
    </div>
  );
}
