// Canon fixture for the Reviews work pane (05 session-reviews/default): Acme
// GmbH, "New reviews this week", Social Media Manager v1. The reviews model is
// phase 2 (map #31); until it lands the pane reads these while
// RELAY_FIXTURES=true.

import type { PaneReview } from "./reviews-pane-model";

export const reviewsFixture: PaneReview[] = [
  {
    id: "fx-review-schneider",
    source: "google",
    rating: 2,
    author: "M. Schneider",
    createdAt: "2026-09-22T08:30:00.000Z",
    text: "Crew arrived two hours late and missed the kitchen.",
    sentiment: "negative",
    reply:
      "Hello M. Schneider, we are sorry our crew arrived two hours late and missed the kitchen. That is not the standard we promise. We would like to offer you a free follow-up clean. Could you reply with your booking number so we can schedule it?\nTeam Acme GmbH",
    replyStatus: "drafted",
  },
  {
    id: "fx-review-lena",
    source: "google",
    rating: 5,
    author: "Lena K.",
    createdAt: "2026-09-23T09:10:00.000Z",
    text: "Spotless office every Monday morning. The crew is quick and friendly.",
    sentiment: "positive",
    reply: "Thank you, Lena! We will pass your kind words on to the Monday crew.\nTeam Acme GmbH",
    replyStatus: "drafted",
  },
  {
    id: "fx-review-david",
    source: "google",
    rating: 4,
    author: "David P.",
    createdAt: "2026-09-20T14:00:00.000Z",
    text: "Reliable crew and flexible scheduling. Invoices could be a bit clearer.",
    sentiment: "positive",
    reply:
      "Thank you, David. Good point on the invoices: we are adding a line per visit from next month.\nTeam Acme GmbH",
    replyStatus: "drafted",
  },
  {
    id: "fx-review-julia",
    source: "google",
    rating: 5,
    author: "Julia M.",
    createdAt: "2026-09-24T11:45:00.000Z",
    text: "Our Augsburg office has never looked better. Great communication.",
    sentiment: "positive",
    reply: "Thank you, Julia! It is a pleasure to look after the Augsburg office.\nTeam Acme GmbH",
    replyStatus: "drafted",
  },
  {
    id: "fx-review-emma",
    source: "trustpilot",
    rating: 3,
    author: "Emma W.",
    createdAt: "2026-09-21T16:20:00.000Z",
    text: "Good clean overall, but the meeting room windows were skipped once.",
    sentiment: "neutral",
    reply:
      "Thank you, Emma. Sorry about the meeting room windows; we have added them to the crew's checklist.\nTeam Acme GmbH",
    replyStatus: "drafted",
  },
];
