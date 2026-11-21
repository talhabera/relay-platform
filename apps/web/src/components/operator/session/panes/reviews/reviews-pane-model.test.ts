import { describe, expect, it } from "vitest";

import { reviewsFixture } from "./reviews-fixtures";
import {
  initialOpenReviewId,
  orderReviews,
  replyNeedsApproval,
  reviewDate,
  reviewsPaneState,
  toggleReview,
  withCheckpoint,
  type PaneReview,
} from "./reviews-pane-model";

const review = (id: string, sentiment: PaneReview["sentiment"]): PaneReview => ({
  id,
  source: "google",
  rating: 3,
  author: id,
  createdAt: "2026-09-22T08:30:00.000Z",
  text: "t",
  sentiment,
  reply: "r",
  replyStatus: "drafted",
});

describe("reviewsPaneState", () => {
  it("is connect until Google Business Profile connects, then empty, then reviews", () => {
    expect(reviewsPaneState({ connected: false, reviews: reviewsFixture })).toBe("connect");
    expect(reviewsPaneState({ connected: true, reviews: null })).toBe("empty");
    expect(reviewsPaneState({ connected: true, reviews: [] })).toBe("empty");
    expect(reviewsPaneState({ connected: true, reviews: reviewsFixture })).toBe("reviews");
  });
});

describe("orderReviews", () => {
  it("puts negative reviews first and keeps the rest in order", () => {
    const list = [review("a", "positive"), review("b", "negative"), review("c", "neutral"), review("d", "negative")];
    expect(orderReviews(list).map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("matches the 05 session-reviews/default order", () => {
    expect(orderReviews(reviewsFixture).map((r) => r.author)).toEqual([
      "M. Schneider",
      "Lena K.",
      "David P.",
      "Julia M.",
      "Emma W.",
    ]);
    expect(initialOpenReviewId(reviewsFixture)).toBe("fx-review-schneider");
    expect(initialOpenReviewId([])).toBeNull();
  });
});

describe("toggleReview", () => {
  it("opens one review at a time", () => {
    expect(toggleReview(null, "a")).toBe("a");
    expect(toggleReview("a", "a")).toBeNull();
    expect(toggleReview("a", "b")).toBe("b");
  });
});

describe("withCheckpoint", () => {
  it("leaves drafts until the checkpoint is approved, then marks replies posted", () => {
    expect(withCheckpoint(reviewsFixture, false)).toBe(reviewsFixture);
    const posted = withCheckpoint([...reviewsFixture, { ...review("x", "neutral"), reply: null }], true);
    expect(posted.slice(0, 5).every((r) => r.replyStatus === "posted")).toBe(true);
    expect(posted[5].replyStatus).toBe("drafted");
    expect(posted.map(replyNeedsApproval)).toEqual([false, false, false, false, false, false]);
  });

  it("needs approval only for drafted replies", () => {
    expect(replyNeedsApproval(review("a", "negative"))).toBe(true);
    expect(replyNeedsApproval({ ...review("a", "negative"), reply: null })).toBe(false);
    expect(replyNeedsApproval({ ...review("a", "negative"), replyStatus: "approved" })).toBe(false);
  });
});

describe("reviewDate", () => {
  it("formats in the company time zone", () => {
    expect(reviewDate("2026-09-22T08:30:00.000Z", "Europe/Berlin")).toBe("22 Sep 2026");
    expect(reviewDate("2026-09-22T23:30:00.000Z", "Europe/Berlin")).toBe("23 Sep 2026");
  });
});
