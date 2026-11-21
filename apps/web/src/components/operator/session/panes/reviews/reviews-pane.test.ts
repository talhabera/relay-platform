import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { SessionSteerProvider } from "@/components/operator/session-steer";

import { hasReviewsPane } from "./load-reviews-pane";
import { reviewsFixture } from "./reviews-fixtures";
import { withCheckpoint } from "./reviews-pane-model";
import { ReviewsPane, type ReviewsPaneProps } from "./reviews-pane";

const base: ReviewsPaneProps = {
  connected: true,
  reviews: reviewsFixture,
  timeZone: "Europe/Berlin",
  canAct: true,
};

const steered = (el: ReactElement) =>
  renderToStaticMarkup(h(SessionSteerProvider, { value: { send: () => {}, isStreaming: false } }, el));

describe("ReviewsPane", () => {
  it("shows the Connect state until Google Business Profile is connected", () => {
    const html = renderToStaticMarkup(h(ReviewsPane, { ...base, connected: false }));
    expect(html).toContain('data-state="connect"');
    expect(html).toContain("Connect Google Business Profile");
    expect(html).toContain('href="/settings/connectors"');
    expect(html).not.toContain('data-slot="review-card"');
  });

  it("shows an empty state when connected but no reviews are in", () => {
    const html = renderToStaticMarkup(h(ReviewsPane, { ...base, reviews: null }));
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("No reviews yet");
  });

  it("renders 05 session-reviews/default: Schneider open with a drafted reply, four collapsed", () => {
    const html = steered(h(ReviewsPane, base));
    expect(html).toContain('data-state="reviews"');
    expect(html.match(/data-slot="review-card"/g)).toHaveLength(5);
    expect(html.match(/data-state="expanded"/g)).toHaveLength(1);
    expect(html.indexOf("M. Schneider")).toBeLessThan(html.indexOf("Lena K."));
    expect(html).toContain("22 Sep 2026");
    expect(html).toContain("Drafted reply");
    expect(html).toContain("/ 4096");
    expect(html).toContain('data-tone="needs-you"');
    expect(html.match(/>Drafted</g)).toHaveLength(5);
    expect(html).toContain('data-brand="trustpilot"');
  });

  it("renders 05 session-reviews/approved: every reply posted, read-only", () => {
    const html = steered(h(ReviewsPane, { ...base, reviews: withCheckpoint(reviewsFixture, true) }));
    expect(html.match(/>Posted</g)).toHaveLength(5);
    expect(html).toContain("Posted reply");
    expect(html).not.toContain('data-tone="needs-you"');
    expect(html).not.toContain("/ 4096");
  });
});

describe("hasReviewsPane", () => {
  it("matches only the Social media package's Social Media Manager", () => {
    expect(hasReviewsPane({ packageSlug: "social-media", name: "Social Media Manager" })).toBe(true);
    expect(hasReviewsPane({ packageSlug: "lead-engine", name: "Social Media Manager" })).toBe(false);
    expect(hasReviewsPane({ packageSlug: "social-media", name: "Other" })).toBe(false);
    expect(hasReviewsPane(null)).toBe(false);
  });
});
