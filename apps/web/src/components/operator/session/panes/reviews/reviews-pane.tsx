"use client";

import { useState } from "react";
import { MessageSquareText, Star } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { useSessionSteer } from "@/components/operator/session-steer";
import { ReviewCard } from "@/components/v2/work/review-card";

import {
  initialOpenReviewId,
  orderReviews,
  replyNeedsApproval,
  reviewDate,
  reviewsPaneState,
  toggleReview,
  type PaneReview,
} from "./reviews-pane-model";

export type ReviewsPaneProps = {
  /** Google Business Profile connected for the company. */
  connected: boolean;
  /** Null until the reviews model lands (phase 2); fixtures fill it in dev. */
  reviews: PaneReview[] | null;
  /** Company time zone for review dates. */
  timeZone: string;
  /** Viewer may steer the session (reply tools). */
  canAct: boolean;
  /** Where "Connect Google Business Profile" goes. */
  connectHref?: string;
};

/**
 * Reviews work pane (05 session-reviews/default, /approved): a list of Review
 * cards, negative first, one expanded at a time with its drafted (or posted)
 * reply. Without Google Business Profile it is a Connect empty state.
 */
export function ReviewsPane({ connected, reviews, timeZone, canAct, connectHref = "/settings/connectors" }: ReviewsPaneProps) {
  const state = reviewsPaneState({ connected, reviews });

  return (
    <section
      aria-label="Reviews"
      data-slot="reviews-pane"
      data-state={state}
      className="flex min-h-0 w-full flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-elevation-1"
    >
      {state === "connect" ? (
        <EmptyState
          icon={Star}
          className="my-auto py-12"
          title="Connect Google Business Profile to answer reviews"
          description="The Social Media Manager drafts a reply to every new review here and posts it once you approve. Connect Google Business Profile to see your reviews."
          action={{ label: "Connect Google Business Profile", href: connectHref }}
        />
      ) : state === "empty" || !reviews ? (
        <EmptyState
          icon={MessageSquareText}
          className="my-auto py-12"
          title="No reviews yet"
          description="New reviews and the drafted replies show up here when the Social Media Manager checks them."
        />
      ) : (
        <ReviewList reviews={reviews} timeZone={timeZone} canAct={canAct} />
      )}
    </section>
  );
}

function ReviewList({ reviews, timeZone, canAct }: { reviews: PaneReview[]; timeZone: string; canAct: boolean }) {
  const steer = useSessionSteer();
  const [openId, setOpenId] = useState<string | null>(() => initialOpenReviewId(reviews));
  const canSteer = canAct && steer.send !== null && !steer.isStreaming;

  return (
    <div data-slot="reviews-list" className="flex min-h-0 flex-col gap-2 overflow-auto">
      {orderReviews(reviews).map((review) => (
        <ReviewCard
          key={review.id}
          source={review.source}
          rating={review.rating}
          author={review.author}
          date={reviewDate(review.createdAt, timeZone)}
          text={review.text}
          sentiment={review.sentiment}
          replyStatus={review.replyStatus}
          reply={review.reply ?? undefined}
          needsApproval={replyNeedsApproval(review)}
          expanded={review.id === openId}
          onExpandedChange={() => setOpenId((id) => toggleReview(id, review.id))}
          onEmoji={canSteer ? () => steer.send?.(`Make the reply to ${review.author} warmer`) : undefined}
          onVariable={
            canSteer ? () => steer.send?.(`Address ${review.author} by name in the reply`) : undefined
          }
        />
      ))}
    </div>
  );
}
