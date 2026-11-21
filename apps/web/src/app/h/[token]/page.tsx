import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { companies, HANDOFF_TAKEOVER_IDLE_MINUTES } from "@/db/schema";
import { loadQuickLinkView } from "@/app/api/h/[token]/quick-link";
import { findHandoffRequestByToken } from "@/lib/handoff/requests";
import { RATE_LIMIT_SURFACES, clientIp, enforceSurface } from "@/lib/rate-limit";

import { FIXTURE_NOW, FIXTURE_TIME_ZONE, FIXTURE_TOKEN, QUICK_LINK_FIXTURES, isQuickLinkScreen } from "./fixtures";
import { QuickLinkPage } from "./quick-link-page";

export const dynamic = "force-dynamic";

/** The URL is a secret: never indexed, never sent on as a referrer. */
export const metadata: Metadata = {
  title: "Answer a customer",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ state?: string }>;
};

/**
 * Public quick-link page (S69, Figma 11c). The token is the only credential;
 * every open counts against the caller's IP like `GET /api/h/[token]`, so the
 * page cannot be used to walk the link space. Outside production,
 * `/h/fixture?state=open|sent|taken-over|handed-back|expired|closed` renders
 * the Figma fixtures without a database for visual QA.
 */
export default async function QuickLinkRoute({ params, searchParams }: Props) {
  const { token } = await params;

  if (token === FIXTURE_TOKEN && process.env.NODE_ENV !== "production") {
    const { state } = await searchParams;
    const view = QUICK_LINK_FIXTURES[isQuickLinkScreen(state) ? state : "open"];
    return (
      <QuickLinkPage
        key={state}
        token={token}
        initialView={view}
        timeZone={FIXTURE_TIME_ZONE}
        idleMinutes={HANDOFF_TAKEOVER_IDLE_MINUTES}
        now={FIXTURE_NOW.toISOString()}
        offline
      />
    );
  }

  const limited = await enforceSurface(RATE_LIMIT_SURFACES.handoffLink({ ip: clientIp(await headers()) }));
  if (!limited.ok) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-6">
        <p className="type-body text-muted-foreground">Too many attempts. Wait a minute and reload the page.</p>
      </main>
    );
  }
  await limited.release();

  const request = await findHandoffRequestByToken(token);
  if (!request) notFound();

  const now = new Date();
  const [view, company] = await Promise.all([
    loadQuickLinkView(request, now),
    db.query.companies.findFirst({ where: eq(companies.id, request.companyId), columns: { timezone: true } }),
  ]);

  return (
    <QuickLinkPage
      token={token}
      initialView={view}
      timeZone={company?.timezone ?? "UTC"}
      idleMinutes={HANDOFF_TAKEOVER_IDLE_MINUTES}
      now={now.toISOString()}
    />
  );
}
