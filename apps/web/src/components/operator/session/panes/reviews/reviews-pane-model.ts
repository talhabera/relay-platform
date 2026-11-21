// Reviews work pane (05 session-reviews/*): pure model, client-safe. The
// reviews data model is phase 2 (map #31), so the pane runs on fixtures
// (`reviews-fixtures.ts`) and shows a Connect empty state until Google
// Business Profile is connected. Everything the pane shows is derived here so
// it can be tested without a DB or a DOM.

import type { ReviewReplyStatus, ReviewSentiment, ReviewSource } from "@/components/v2/work/review-card";

export type PaneReview = {
  id: string;
  source: ReviewSource;
  /** 1-5 stars. */
  rating: number;
  author: string;
  /** ISO timestamp the review was left. */
  createdAt: string;
  text: string;
  sentiment: ReviewSentiment;
  /** The agent's drafted (or posted) reply; null while none is drafted. */
  reply: string | null;
  replyStatus: ReviewReplyStatus;
};

/** What the pane renders: Connect state, no reviews yet, or the review list. */
export type ReviewsPaneState = "connect" | "empty" | "reviews";

export function reviewsPaneState(args: { connected: boolean; reviews: PaneReview[] | null }): ReviewsPaneState {
  if (!args.connected) return "connect";
  if (!args.reviews || args.reviews.length === 0) return "empty";
  return "reviews";
}

/**
 * Pane order: negative reviews first (the agent treats them first), the rest
 * in the order the agent listed them. Stable, so ties keep their order.
 */
export function orderReviews(reviews: PaneReview[]): PaneReview[] {
  return reviews
    .map((review, index) => ({ review, index }))
    .sort((a, b) => {
      const an = a.review.sentiment === "negative" ? 0 : 1;
      const bn = b.review.sentiment === "negative" ? 0 : 1;
      return an - bn || a.index - b.index;
    })
    .map(({ review }) => review);
}

/** The review open by default: the first in pane order. */
export function initialOpenReviewId(reviews: PaneReview[]): string | null {
  return orderReviews(reviews)[0]?.id ?? null;
}

/** Accordion: one review open at a time; clicking the open one closes it. */
export function toggleReview(openId: string | null, clickedId: string): string | null {
  return openId === clickedId ? null : clickedId;
}

/** Posting a reply is a checkpoint: drafted replies wait for a person. */
export function replyNeedsApproval(review: PaneReview): boolean {
  return review.reply !== null && review.replyStatus === "drafted";
}

/**
 * Applies the session's "Post replies" checkpoint: once it is approved every
 * drafted reply counts as posted (05 session-reviews/approved).
 */
export function withCheckpoint(reviews: PaneReview[], approved: boolean): PaneReview[] {
  if (!approved) return reviews;
  return reviews.map((r) => (r.reply !== null && r.replyStatus !== "posted" ? { ...r, replyStatus: "posted" } : r));
}

/** "22 Sep 2026" in the company time zone (en-US parts: en-GB says "Sept" on newer ICU). */
export function reviewDate(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone })
    .formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("year")}`;
}
