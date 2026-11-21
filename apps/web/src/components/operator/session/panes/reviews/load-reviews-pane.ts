import { and, eq, isNull } from "drizzle-orm";
import { PACKAGE_CATALOG } from "@relay/db";

import { db } from "@/db";
import { integrations } from "@/db/schema";
import { isFixturesEnabled } from "@/lib/fixtures";

import { reviewsFixture } from "./reviews-fixtures";
import type { ReviewsPaneProps } from "./reviews-pane";
import { withCheckpoint } from "./reviews-pane-model";

const SOCIAL_NAME =
  PACKAGE_CATALOG.find((p) => p.slug === "social-media")?.agents.find((a) => a.key === "social")?.name ??
  "Social Media Manager";

/**
 * Sessions that get the Reviews work pane: the Social media package's Social
 * Media Manager. The same agent also gets the Calendar pane (S53); the page
 * picks between them (see the S54 wiring note).
 */
export function hasReviewsPane(agent: { packageSlug: string | null | undefined; name: string } | null | undefined): boolean {
  return agent?.packageSlug === "social-media" && agent.name === SOCIAL_NAME;
}

/** True when the company's Google Business Profile connector is connected. */
async function googleBusinessConnected(companyId: string): Promise<boolean> {
  const row = await db.query.integrations.findFirst({
    columns: { status: true },
    where: and(
      eq(integrations.companyId, companyId),
      eq(integrations.type, "google_business_profile"),
      isNull(integrations.agentId),
    ),
  });
  return row?.status === "connected";
}

/**
 * Reviews work pane props for a session the page already authorized (company
 * membership + operator access). The reviews model is phase 2 (map #31): with
 * RELAY_FIXTURES=true the pane shows the canon Acme reviews as if Google
 * Business Profile were connected; otherwise it is the Connect state until it
 * connects, then "No reviews yet". `repliesApproved` is true once the
 * session's "Post replies" checkpoint is approved (05 session-reviews/approved).
 */
export async function loadReviewsPane(args: {
  companyId: string;
  timeZone: string;
  canAct: boolean;
  repliesApproved?: boolean;
}): Promise<ReviewsPaneProps> {
  if (isFixturesEnabled()) {
    return {
      connected: true,
      reviews: withCheckpoint(reviewsFixture, args.repliesApproved ?? false),
      timeZone: args.timeZone,
      canAct: args.canAct,
    };
  }
  return {
    connected: await googleBusinessConnected(args.companyId),
    reviews: null,
    timeZone: args.timeZone,
    canAct: args.canAct,
  };
}
